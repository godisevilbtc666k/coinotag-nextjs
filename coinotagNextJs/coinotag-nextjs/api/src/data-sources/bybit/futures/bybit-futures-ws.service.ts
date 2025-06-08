import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as WebSocket from 'ws';
import { Subject } from 'rxjs';
import {
  BybitFundingData,
  BybitFuturesTickerData,
  BybitFuturesTickerEvent,
  BybitTickersResponse,
  BybitApiResponse, // FR/OI için gerekli
  BybitTickerItem // FR/OI için gerekli
} from '../bybit.types';
import { WsConnectionStatus } from '../../../common/types/connection-status.types';
import axios, { AxiosResponse } from 'axios';

// Helper function for delay
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

@Injectable()
export class BybitFuturesWsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BybitFuturesWsService.name);
  private readonly futuresWsUrl = 'wss://stream.bybit.com/v5/public/linear';
  private readonly restApiUrl = 'https://api.bybit.com/v5/market/tickers?category=linear'; // FR/OI için
  private readonly numberOfConnections = 5; // Kaç bağlantı açılacak?
  private wsPool: WebSocket.WebSocket[] = [];
  private connectionStates: WsConnectionStatus[] = [];
  private connectionAttemptIntervals: (NodeJS.Timeout | null)[] = [];
  private pingIntervals: (NodeJS.Timeout | null)[] = [];
  private subscribedSymbolsPerConnection: Set<string>[] = [];
  private isUpdatingSubscriptions: boolean[] = [];

  private futuresTickerSubject = new Subject<BybitFuturesTickerData[]>();
  public futuresTickerStream$ = this.futuresTickerSubject.asObservable();
  
  // Funding Rate / OI için
  private fundingDataSubject = new Subject<BybitFundingData[]>();
  public fundingDataStream$ = this.fundingDataSubject.asObservable();
  private isFetchingFundingOi = false;
  private fundingOiIntervalId: NodeJS.Timeout | null = null;

  private validFuturesSymbols = new Set<string>();
  private latestSymbolsFromCache: string[] = [];

  constructor(
    private configService: ConfigService,
    private eventEmitter: EventEmitter2,
  ) {
    this.logger.log('BybitFuturesWsService CONSTRUCTOR called.');
    for (let i = 0; i < this.numberOfConnections; i++) {
      this.connectionStates.push('disconnected');
      this.connectionAttemptIntervals.push(null);
      this.pingIntervals.push(null);
      this.subscribedSymbolsPerConnection.push(new Set<string>());
      this.isUpdatingSubscriptions.push(false);
    }
  }

  async onModuleInit() {
    this.logger.log('BybitFuturesWsService ON_MODULE_INIT started.');
    await this.fetchValidFuturesSymbols(); // Önce geçerli sembolleri çek
    this.connectAllStreams(); // Tüm WS bağlantılarını başlat
    this.listenForSymbolUpdates();
    
    // İlk FR/OI verisini çek ve interval başlat
    await this.fetchFundingOiData();
    this.startFundingOiInterval();

    this.logger.log('BybitFuturesWsService ON_MODULE_INIT finished.');
  }

  onModuleDestroy() {
    this.logger.log('BybitFuturesWsService destroying...');
    this.wsPool.forEach((ws, index) => this.closeStream(index));
    if (this.fundingOiIntervalId) {
      clearInterval(this.fundingOiIntervalId);
      this.logger.log('Cleared Bybit Funding/OI fetch interval.');
    }
  }

  // --- FR/OI Metotları (Eski BybitService'ten alındı) --- 
  private startFundingOiInterval() {
     this.logger.log('Starting Funding/OI fetch interval (5 minutes).');
     if (this.fundingOiIntervalId) clearInterval(this.fundingOiIntervalId);
     this.fundingOiIntervalId = setInterval(() => {
         this.logger.log('Funding/OI INTERVAL triggered. Calling fetchData...');
         this.fetchFundingOiData();
     }, 300000);
  }

  private async fetchFundingOiData(): Promise<void> {
    this.logger.log('[BYB-FR-OI] Fetching Funding Rate & OI data started.');
    if (this.isFetchingFundingOi) {
      this.logger.debug('[BYB-FR-OI] Fetch already in progress, skipping.');
      return;
    }
    this.isFetchingFundingOi = true;

    try {
      const response: AxiosResponse<BybitApiResponse> = await axios.get(this.restApiUrl, {
         headers: { 'Accept': 'application/json' },
         timeout: 10000
      });

      if (response.data.retCode !== 0 || !response.data.result || !response.data.result.list) {
        this.logger.error(`[BYB-FR-OI] Error fetching data: ${response.data?.retMsg || 'Invalid structure'} (Code: ${response.data?.retCode})`);
        return;
      }

      const fundingData: BybitFundingData[] = response.data.result.list
        .map((item: BybitTickerItem) => {
          const cleanedSymbol = this.cleanSymbol(item.symbol);
          if (!cleanedSymbol) return null;
          const fundingRateNum = item.fundingRate ? parseFloat(item.fundingRate) : undefined;
          const openInterestValueNum = item.openInterestValue ? parseFloat(item.openInterestValue) : undefined;
          return {
            symbol: cleanedSymbol,
            fundingRate: isNaN(fundingRateNum) ? undefined : fundingRateNum,
            openInterestValue: isNaN(openInterestValueNum) ? undefined : openInterestValueNum,
          };
        })
        .filter(item => item !== null && (item.fundingRate !== undefined || item.openInterestValue !== undefined));

      this.logger.log(`[BYB-FR-OI] Processed ${fundingData.length} valid funding/OI entries.`);
      if (fundingData.length > 0) {
        this.fundingDataSubject.next(fundingData);
      }
    } catch (error) {
      this.logger.error(`[BYB-FR-OI] Error fetching data: ${error.message}`, error.stack);
    } finally {
      this.isFetchingFundingOi = false;
    }
  }

  // --- WebSocket Metotları (Spot ile benzer) --- 

  private async fetchValidFuturesSymbols(): Promise<void> {
     this.logger.log('[BYB-FUT-SYMBOLS] Fetching valid linear futures symbols...');
     const url = 'https://api.bybit.com/v5/market/tickers?category=linear&limit=1000';
     const timeout = 10000;
     try {
       const response: AxiosResponse<BybitTickersResponse> = await axios.get(url, { timeout });
       if (response.data && response.data.retCode === 0 && response.data.result?.list) {
         this.validFuturesSymbols = new Set(response.data.result.list.map(item => item.symbol));
         this.logger.log(`[BYB-FUT-SYMBOLS] Successfully fetched ${this.validFuturesSymbols.size} linear futures symbols.`);
       } else {
         this.logger.error(`[BYB-FUT-SYMBOLS] Failed to fetch symbols or invalid response: ${response.data?.retMsg || 'Error'} (Code: ${response.data?.retCode})`);
       }
     } catch (error) {
       this.logger.error(`[BYB-FUT-SYMBOLS] Error fetching symbols: ${error.message}`, error.stack);
     }
   }

  private connectAllStreams() {
    this.logger.log(`Initiating ${this.numberOfConnections} Futures WS connections...`);
    for (let i = 0; i < this.numberOfConnections; i++) {
      this.connectStream(i);
    }
  }

  private connectStream(index: number) {
    if (this.wsPool[index] || this.connectionStates[index] === 'connecting') {
      this.logger.warn(`[BYB-FUT-CONN-${index}] Connection already established or in progress.`);
      return;
    }
    this.connectionStates[index] = 'connecting';
    this.logger.log(`[BYB-FUT-CONN-${index}] Attempting to connect...`);

    try {
      const ws = new WebSocket(this.futuresWsUrl);
      this.wsPool[index] = ws;
      this.logger.log(`[BYB-FUT-CONN-${index}] Successfully created WebSocket instance. Adding listeners...`);
      
      ws.on('open', () => {
        this.logger.log(`[BYB-FUT-CONN-${index}] WebSocket connection established.`);
        this.connectionStates[index] = 'connected';
        this.clearConnectionAttemptInterval(index);
        this.startPing(index);
        this.subscribeSymbolsToConnection(index);
      });

      ws.on('message', (data: WebSocket.RawData) => {
        this.handleIncomingMessage(index, data);
      });

      ws.on('error', (error: Error) => {
        this.logger.error(`[BYB-FUT-CONN-${index}] WebSocket 'error' event received:`, error);
        this.handleDisconnect(index);
      });

      ws.on('close', (code: number, reason: Buffer) => {
        const reasonString = reason ? reason.toString() : 'No reason provided';
        this.logger.log(`[BYB-FUT-CONN-${index}] WebSocket 'close' event received. Code: ${code}, Reason: "${reasonString}"`);
        if (code !== 1000) {
          this.handleDisconnect(index);
        } else {
          this.connectionStates[index] = 'disconnected';
          this.wsPool[index] = null;
          this.subscribedSymbolsPerConnection[index].clear();
          this.stopPing(index);
        }
      });

    } catch (wsError) {
      this.logger.error(`[BYB-FUT-CONN-${index}] !!! FAILED to create WebSocket instance: ${wsError.message}`, wsError.stack);
      this.connectionStates[index] = 'error';
      this.handleDisconnect(index);
    }
  }
  
  private handleIncomingMessage(index: number, data: WebSocket.RawData) {
     const rawDataString = data.toString(); // Loglama için stringe çevir
     // this.logger.verbose(`[BYB-FUT-RAW-MSG-${index}] Received: ${rawDataString}`); // Gelen ham mesajı logla (Çok fazla olabilir)
 
      try {
        const message = JSON.parse(rawDataString); // String üzerinden parse et
        if (message.op === 'pong') return;
        if (message.op === 'subscribe') {
           const argsString = message.args ? message.args.join(', ') : 'N/A';
           const reqId = message.req_id || 'N/A';
           if(message.success) {
               this.logger.log(`[BYB-FUT-MSG-${index}] Successfully subscribed: Args=[${argsString}], ConnId=${message.conn_id ?? 'N/A'}, ReqID=${reqId}`);
               // Başarılı olursa zaten subscribeSymbolsToConnection içinde set'e eklenmişti.
           } else {
                this.logger.error(`[BYB-FUT-MSG-${index}] Failed subscription: ${message.ret_msg} (ReqID: ${reqId}, Args: [${argsString}])`);
                // --- DEĞİŞİKLİK: 'Already subscribed' durumunda state'i GÜNCELLEME --- 
                // if (message.ret_msg && message.ret_msg.toLowerCase().includes('already subscribed') && message.args && Array.isArray(message.args)) {
                //    this.logger.warn(`[BYB-FUT-MSG-${index}] Received 'already subscribed' for [${argsString}]. NOT updating local state.`);
                //    // message.args.forEach((topic: string) => {
                //    //     if (typeof topic === 'string') {
                //    //        // Bu satır kaldırıldı: this.subscribedSymbolsPerConnection[index].add(topic);
                //    //     }
                //    // });
                // }
                // --- DEĞİŞİKLİK SONU ---
           }
           return;
        }
        if (message.topic && message.topic.startsWith('tickers.') && message.data) {
          this.logger.verbose(`[BYB-FUT-PROC-${index}] Processing ticker message for topic: ${message.topic}`); 
          const event = message as BybitFuturesTickerEvent;
          const cleanedSymbol = this.cleanSymbol(event.data.symbol);
          if (cleanedSymbol) {
            this.logger.verbose(`[BYB-FUT-PROC-${index}] Cleaned symbol: ${cleanedSymbol}. Sending to subject...`);
            const dataToSend: BybitFuturesTickerData = { 
                ...event.data, 
                symbol: cleanedSymbol
            };
            this.futuresTickerSubject.next([dataToSend]);
          } else {
            this.logger.warn(`[BYB-FUT-PROC-${index}] cleanSymbol returned null for raw symbol: ${event.data.symbol}`);
          }
        } else {
          // Ticker mesajı değilse veya data yoksa logla (opsiyonel, çok fazla log üretebilir)
          // this.logger.debug(`[BYB-FUT-MSG-${index}] Received non-ticker or no-data message: ${rawDataString}`);
        }
      } catch (error) {
        this.logger.error(`[BYB-FUT-MSG-${index}] Failed to parse message: ${rawDataString}`, error);
      }
  }

  private handleDisconnect(index: number) {
    this.logger.warn(`[BYB-FUT-RECONN-${index}] Handling disconnect.`);
    this.closeStream(index, false); 
    this.scheduleReconnection(index);
  }

  private scheduleReconnection(index: number) {
     if (this.connectionAttemptIntervals[index] || this.connectionStates[index] === 'connecting' || (this.wsPool[index] && this.wsPool[index].readyState === WebSocket.OPEN)) return;
     const delay = 5000 + Math.random() * 2000;
     this.logger.log(`[BYB-FUT-RECONN-${index}] Scheduling reconnection in ${(delay / 1000).toFixed(1)}s...`);
     this.connectionAttemptIntervals[index] = setTimeout(() => {
         this.connectionAttemptIntervals[index] = null;
         if (!this.wsPool[index] || this.wsPool[index].readyState === WebSocket.CLOSED) {
             this.logger.log(`[BYB-FUT-RECONN-${index}] Attempting reconnect now...`);
             this.connectStream(index);
         }
     }, delay);
  }

  private clearConnectionAttemptInterval(index: number) {
     if (this.connectionAttemptIntervals[index]) {
         clearTimeout(this.connectionAttemptIntervals[index]);
         this.connectionAttemptIntervals[index] = null;
     }
  }
  
  private startPing(index: number) {
     this.stopPing(index);
     this.pingIntervals[index] = setInterval(() => {
         if (this.wsPool[index]?.readyState === WebSocket.OPEN) {
             this.wsPool[index].send(JSON.stringify({ op: 'ping', req_id: `fut_ping_${index}_${Date.now()}` }));
         } else {
             this.logger.warn(`[BYB-FUT-PING-${index}] Cannot send ping, connection not open. Handling disconnect.`);
             this.stopPing(index);
             this.handleDisconnect(index);
         }
     }, 20000);
  }

  private stopPing(index: number) {
      if (this.pingIntervals[index]) {
          clearInterval(this.pingIntervals[index]);
          this.pingIntervals[index] = null;
      }
  }

  private closeStream(index: number, log = true) {
      this.stopPing(index);
      this.clearConnectionAttemptInterval(index);
      const ws = this.wsPool[index];
      if (ws) {
          if (log) this.logger.log(`[BYB-FUT-CONN-${index}] Closing connection.`);
          ws.removeAllListeners();
          ws.terminate();
          this.wsPool[index] = null;
          this.subscribedSymbolsPerConnection[index].clear();
          this.connectionStates[index] = 'disconnected'; 
      }
  }

  private listenForSymbolUpdates() {
    this.logger.log('[BYB-FUT-UPDATE] Listening for cache.symbols.updated events...');
    this.eventEmitter.on('cache.symbols.updated', async (symbols: string[]) => {
      this.logger.log(`[BYB-FUT-UPDATE] Received ${symbols.length} symbols.`);
      const newSymbolsBase = symbols.filter(s => s && typeof s === 'string');
      const previousSymbolsString = JSON.stringify([...this.latestSymbolsFromCache].sort());
      const newSymbolsString = JSON.stringify([...newSymbolsBase].sort());
      if (previousSymbolsString === newSymbolsString) {
          this.logger.log('[BYB-FUT-UPDATE] Symbol list unchanged.');
          return;
      }
      this.logger.log('[BYB-FUT-UPDATE] Symbol list changed. Updating subscriptions...');
      this.latestSymbolsFromCache = newSymbolsBase;
      for(let i=0; i< this.numberOfConnections; i++) {
          if (this.wsPool[i]?.readyState === WebSocket.OPEN) {
            await this.subscribeSymbolsToConnection(i);
          }
      }
    });
  }

  private async subscribeSymbolsToConnection(index: number) {
    if (this.isUpdatingSubscriptions[index]) {
      this.logger.verbose(`[BYB-FUT-SUB-${index}] Subscription update already in progress. Skipping this call.`);
        return;
    }
    this.isUpdatingSubscriptions[index] = true;
    this.logger.verbose(`[BYB-FUT-SUB-${index}] Starting subscription update process (Lock acquired).`);

    const ws = this.wsPool[index];
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      this.logger.warn(`[BYB-FUT-SUB-${index}] WebSocket not open. Cannot subscribe/unsubscribe.`);
      this.isUpdatingSubscriptions[index] = false;
      return;
    }

    const previousSubscriptions = new Set(this.subscribedSymbolsPerConnection[index]);
    // Genişletilmiş meme coin listesi
    const memeCoinsWithPrefix = new Set(['BONK', 'CAT', 'CHEEMS', 'FLOKI', 'LUNC', 'PEPE', 'RATS', 'SATS', 'WHY', 'X', 'XEC', 'SHIB']);
    const requiredTopics = new Set<string>();
    this.latestSymbolsFromCache.forEach(cleanedSymbol => {
        let rawSymbol = `${cleanedSymbol}USDT`;
        
        // MOG için özel durum (1000000)
        if (cleanedSymbol === 'MOG') {
            rawSymbol = `${cleanedSymbol}1000000USDT`;
        } else if (memeCoinsWithPrefix.has(cleanedSymbol)) {
            // Bybit için format: Sembol + 1000 + USDT
            rawSymbol = `${cleanedSymbol}1000USDT`;
        }
        
        if (this.validFuturesSymbols.has(rawSymbol)) {
            requiredTopics.add(`tickers.${rawSymbol}`);
        } else {
            const nonPrefixedRawSymbol = `${cleanedSymbol}USDT`;
            if (rawSymbol !== nonPrefixedRawSymbol && this.validFuturesSymbols.has(nonPrefixedRawSymbol)) {
                requiredTopics.add(`tickers.${nonPrefixedRawSymbol}`);
            } 
        }
    });

    const topicsToSubscribe = Array.from(requiredTopics);
    const topicsToUnsubscribe = Array.from(previousSubscriptions);

    try {
        if (topicsToUnsubscribe.length > 0) {
            this.logger.log(`[BYB-FUT-UNSUB-${index}] Attempting to unsubscribe from ALL ${topicsToUnsubscribe.length} previous topics...`);
            for (let i = 0; i < topicsToUnsubscribe.length; i += 10) {
                const batch = topicsToUnsubscribe.slice(i, i + 10);
                const unsubscriptionMessage = {
                  op: "unsubscribe",
                  args: batch,
                  req_id: `unsub-all-${index}-${i}-${Date.now()}`
                };
                this.logger.verbose(`[BYB-FUT-UNSUB-${index}] Sending UNSUBSCRIBE: ${JSON.stringify(unsubscriptionMessage)}`);
                ws.send(JSON.stringify(unsubscriptionMessage));
                await sleep(250);
            }
            this.logger.log(`[BYB-FUT-UNSUB-${index}] Finished sending unsubscribe requests. Clearing local state.`);
            this.subscribedSymbolsPerConnection[index].clear();
        } else {
            this.subscribedSymbolsPerConnection[index].clear();
            this.logger.verbose(`[BYB-FUT-UNSUB-${index}] No previous subscriptions to unsubscribe from.`);
        }

        this.logger.verbose(`[BYB-FUT-SUB-${index}] Waiting 500ms after unsubscribing...`);
        await sleep(500);

        if (topicsToSubscribe.length > 0) {
            this.logger.log(`[BYB-FUT-SUB-${index}] Attempting to subscribe to ALL ${topicsToSubscribe.length} required topics...`);
            for (let i = 0; i < topicsToSubscribe.length; i += 10) {
                const batch = topicsToSubscribe.slice(i, i + 10);
                const subscriptionMessage = {
                  op: "subscribe",
                  args: batch,
                  req_id: `sub-all-${index}-${i}-${Date.now()}`
                };
                this.logger.verbose(`[BYB-FUT-SUB-${index}] Sending SUBSCRIBE: ${JSON.stringify(subscriptionMessage)}`);
                ws.send(JSON.stringify(subscriptionMessage));
                batch.forEach(topic => this.subscribedSymbolsPerConnection[index].add(topic));
                await sleep(250);
            }
            this.logger.log(`[BYB-FUT-SUB-${index}] Finished sending subscribe requests.`);
        } else {
            this.logger.log(`[BYB-FUT-SUB-${index}] No topics required for subscription.`);
        }
    } catch (error) {
        this.logger.error(`[BYB-FUT-SUB-${index}] Error during subscription update process:`, error);
    } finally {
        this.isUpdatingSubscriptions[index] = false;
        this.logger.verbose(`[BYB-FUT-SUB-${index}] Subscription update process finished (Lock released). Current local count: ${this.subscribedSymbolsPerConnection[index].size}`);
    }
  }

  private cleanSymbol(rawSymbol: string | undefined | null): string | null {
    if (!rawSymbol) return null;
    
    // Meme coin listesi - prefix kontrolü için
    const memeCoinsWithPrefix = new Set(['BONK', 'CAT', 'CHEEMS', 'FLOKI', 'LUNC', 'PEPE', 'RATS', 'SATS', 'WHY', 'X', 'XEC', 'SHIB']);
    
    // Bybit için "1000" suffix kısmını temizlemek için RegExp güncellendi
    // MOG için 1000000 suffix'i de eklendi 
    let symbol = rawSymbol.toUpperCase().replace(/(\d+X|\d+L|\d+S|PERP)$/, '');
    
    // 1000 suffix'i olan meme coinler için işlem
    for (const memeCoin of memeCoinsWithPrefix) {
      if (symbol.startsWith(`${memeCoin}1000`)) {
        symbol = symbol.replace(`${memeCoin}1000`, memeCoin);
        break;
      }
    }
    
    // MOG için özel durum
    if (symbol.startsWith('MOG1000000')) {
      symbol = symbol.replace('MOG1000000', 'MOG');
    }
    
    const validEndings = ['USDT', 'BUSD', 'USDC', 'TUSD'];
    let cleaned = null;
    for (const ending of validEndings) {
      if (symbol.endsWith(ending)) {
        cleaned = symbol.substring(0, symbol.length - ending.length);
        break;
      }
    }
    if (!cleaned || cleaned.length < 1) return null;
    if (cleaned === 'WBT') cleaned = 'WBTC';
    if (/^\d+/.test(cleaned)) cleaned = cleaned.replace(/^\d+/, '');
    return (!cleaned || cleaned.length < 1) ? null : cleaned;
  }
} 