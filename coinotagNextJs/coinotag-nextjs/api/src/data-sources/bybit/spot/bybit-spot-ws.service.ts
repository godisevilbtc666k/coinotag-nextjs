import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as WebSocket from 'ws';
import { Subject } from 'rxjs';
import { BybitSpotTickerData, BybitTickersResponse, BybitSpotTickerEvent } from '../bybit.types'; // Ana tiplerden alalım
import { WsConnectionStatus } from '../../../common/types/connection-status.types';
import axios, { AxiosResponse } from 'axios';

// Helper function for delay
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

@Injectable()
export class BybitSpotWsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BybitSpotWsService.name);
  private readonly spotWsUrl = 'wss://stream.bybit.com/v5/public/spot';
  private readonly numberOfConnections = 5; // Kaç bağlantı açılacak?
  private wsPool: WebSocket.WebSocket[] = [];
  private connectionStates: WsConnectionStatus[] = [];
  private connectionAttemptIntervals: (NodeJS.Timeout | null)[] = [];
  private pingIntervals: (NodeJS.Timeout | null)[] = [];
  private subscribedSymbolsPerConnection: Set<string>[] = [];
  private isUpdatingSubscriptions: boolean[] = [];

  private spotTickerSubject = new Subject<BybitSpotTickerData[]>();
  public spotTickerStream$ = this.spotTickerSubject.asObservable();

  private validSpotSymbols = new Set<string>();
  private latestSymbolsFromCache: string[] = [];

  constructor(
    private configService: ConfigService,
    private eventEmitter: EventEmitter2,
  ) {
    this.logger.log('BybitSpotWsService CONSTRUCTOR called.');
    // Başlangıç durumlarını ayarla
    for (let i = 0; i < this.numberOfConnections; i++) {
      this.connectionStates.push('disconnected');
      this.connectionAttemptIntervals.push(null);
      this.pingIntervals.push(null);
      this.subscribedSymbolsPerConnection.push(new Set<string>());
      this.isUpdatingSubscriptions.push(false);
    }
  }

  async onModuleInit() {
    this.logger.log('BybitSpotWsService ON_MODULE_INIT started.');
    await this.fetchValidSpotSymbols(); // Önce geçerli sembolleri çek
    this.connectAllStreams(); // Tüm bağlantıları başlat
    this.listenForSymbolUpdates();
    this.logger.log('BybitSpotWsService ON_MODULE_INIT finished.');
  }

  onModuleDestroy() {
    this.logger.log('BybitSpotWsService destroying...');
    this.wsPool.forEach((ws, index) => this.closeStream(index));
  }

  // --- TEMEL METOTLAR (İçleri doldurulacak) --- 

  private async fetchValidSpotSymbols(): Promise<void> {
    this.logger.log('[BYB-SPOT-SYMBOLS] Fetching valid spot symbols...');
    const spotUrl = 'https://api.bybit.com/v5/market/tickers?category=spot&limit=1000';
    const timeout = 10000;
    try {
      const response: AxiosResponse<BybitTickersResponse> = await axios.get(spotUrl, { timeout });
      if (response.data && response.data.retCode === 0 && response.data.result?.list) {
        this.validSpotSymbols = new Set(response.data.result.list.map(item => item.symbol));
        this.logger.log(`[BYB-SPOT-SYMBOLS] Successfully fetched ${this.validSpotSymbols.size} spot symbols.`);
      } else {
        this.logger.error(`[BYB-SPOT-SYMBOLS] Failed to fetch Spot symbols or invalid response: ${response.data?.retMsg || 'Error'} (Code: ${response.data?.retCode})`);
      }
    } catch (error) {
      this.logger.error(`[BYB-SPOT-SYMBOLS] Error fetching Spot symbols: ${error.message}`, error.stack);
    }
  }

  private connectAllStreams() {
    this.logger.log(`Initiating ${this.numberOfConnections} Spot WS connections...`);
    for (let i = 0; i < this.numberOfConnections; i++) {
      this.connectStream(i);
    }
  }

  private connectStream(index: number) {
    if (this.wsPool[index] || this.connectionStates[index] === 'connecting') {
      this.logger.warn(`[BYB-SPOT-CONN-${index}] Connection already established or in progress.`);
      return;
    }
    this.connectionStates[index] = 'connecting';
    this.logger.log(`[BYB-SPOT-CONN-${index}] Attempting to connect...`);

    try {
      const ws = new WebSocket(this.spotWsUrl);
      this.wsPool[index] = ws;
      this.logger.log(`[BYB-SPOT-CONN-${index}] Successfully created WebSocket instance. Adding listeners...`);
      
      ws.on('open', () => {
        this.logger.log(`[BYB-SPOT-CONN-${index}] WebSocket connection established.`);
        this.connectionStates[index] = 'connected';
        this.clearConnectionAttemptInterval(index);
        this.startPing(index);
        // Bağlantı açıldığında kendi sembollerine abone olmalı
        this.subscribeSymbolsToConnection(index);
      });

      ws.on('message', (data: WebSocket.RawData) => {
        this.handleIncomingMessage(index, data);
      });

      ws.on('error', (error: Error) => {
        this.logger.error(`[BYB-SPOT-CONN-${index}] WebSocket 'error' event received:`, error);
        this.handleDisconnect(index);
      });

      ws.on('close', (code: number, reason: Buffer) => {
        const reasonString = reason ? reason.toString() : 'No reason provided';
        this.logger.log(`[BYB-SPOT-CONN-${index}] WebSocket 'close' event received. Code: ${code}, Reason: "${reasonString}"`);
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
      this.logger.error(`[BYB-SPOT-CONN-${index}] !!! FAILED to create WebSocket instance: ${wsError.message}`, wsError.stack);
      this.connectionStates[index] = 'error';
      this.handleDisconnect(index);
    }
  }
  
  private handleIncomingMessage(index: number, data: WebSocket.RawData) {
     try {
        const message = JSON.parse(data.toString());
        if (message.op === 'pong') return;
        if (message.op === 'subscribe') {
            const argsString = message.args ? message.args.join(', ') : 'N/A';
            const reqId = message.req_id || 'N/A';
            if(message.success) {
                this.logger.log(`[BYB-SPOT-MSG-${index}] Successfully subscribed: Args=[${argsString}], ReqID=${reqId}`);
            } else {
                 this.logger.error(`[BYB-SPOT-MSG-${index}] Failed subscription: ${message.ret_msg} (ReqID: ${reqId}, Args: [${argsString}])`);
                 if (message.ret_msg && message.ret_msg.toLowerCase().includes('already subscribed') && message.args && Array.isArray(message.args)) {
                     this.logger.warn(`[BYB-SPOT-MSG-${index}] Received 'already subscribed' for [${argsString}]. Updating local state.`);
                     message.args.forEach((topic: string) => {
                         if (typeof topic === 'string') {
                            this.subscribedSymbolsPerConnection[index].add(topic);
                         }
                     });
                 }
            }
            return;
        }
        if (message.topic && message.topic.startsWith('tickers.') && message.data) {
             const event = message as BybitSpotTickerEvent; 
             const cleanedSymbol = this.cleanSymbol(event.data.symbol);
             if (cleanedSymbol) {
                 const dataToSend: BybitSpotTickerData = { ...event.data, symbol: cleanedSymbol };
                 this.spotTickerSubject.next([dataToSend]); // Array içinde gönderelim
                 // if (cleanedSymbol === 'BTC') { /* debug log */ }
             }
        }
     } catch (error) {
        this.logger.error(`[BYB-SPOT-MSG-${index}] Failed to parse message: ${data.toString()}`, error);
     }
  }

  private handleDisconnect(index: number) {
    this.logger.warn(`[BYB-SPOT-RECONN-${index}] Handling disconnect.`);
    this.closeStream(index, false); // Logsuz kapat
    this.scheduleReconnection(index);
  }

  private scheduleReconnection(index: number) {
     if (this.connectionAttemptIntervals[index] || this.connectionStates[index] === 'connecting' || (this.wsPool[index] && this.wsPool[index].readyState === WebSocket.OPEN)) return;
     const delay = 5000 + Math.random() * 2000;
     this.logger.log(`[BYB-SPOT-RECONN-${index}] Scheduling reconnection in ${(delay / 1000).toFixed(1)}s...`);
     this.connectionAttemptIntervals[index] = setTimeout(() => {
         this.connectionAttemptIntervals[index] = null;
         if (!this.wsPool[index] || this.wsPool[index].readyState === WebSocket.CLOSED) {
             this.logger.log(`[BYB-SPOT-RECONN-${index}] Attempting reconnect now...`);
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
             this.wsPool[index].send(JSON.stringify({ op: 'ping', req_id: `spot_ping_${index}_${Date.now()}` }));
         } else {
             this.logger.warn(`[BYB-SPOT-PING-${index}] Cannot send ping, connection not open. Handling disconnect.`);
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
          if (log) this.logger.log(`[BYB-SPOT-CONN-${index}] Closing connection.`);
          ws.removeAllListeners();
          ws.terminate();
          this.wsPool[index] = null;
          this.subscribedSymbolsPerConnection[index].clear();
          this.connectionStates[index] = 'disconnected'; 
      }
  }

  private listenForSymbolUpdates() {
    this.logger.log('[BYB-SPOT-UPDATE] Listening for cache.symbols.updated events...');
    this.eventEmitter.on('cache.symbols.updated', async (symbols: string[]) => {
      this.logger.log(`[BYB-SPOT-UPDATE] Received ${symbols.length} symbols.`);
      const newSymbolsBase = symbols.filter(s => s && typeof s === 'string');
      const previousSymbolsString = JSON.stringify([...this.latestSymbolsFromCache].sort());
      const newSymbolsString = JSON.stringify([...newSymbolsBase].sort());
      if (previousSymbolsString === newSymbolsString) {
          this.logger.log('[BYB-SPOT-UPDATE] Symbol list unchanged.');
          return;
      }
      this.logger.log('[BYB-SPOT-UPDATE] Symbol list changed. Updating subscriptions...');
      this.latestSymbolsFromCache = newSymbolsBase;
      // Tüm bağlantılar için abonelikleri güncelle
      for(let i=0; i< this.numberOfConnections; i++) {
          if (this.wsPool[i]?.readyState === WebSocket.OPEN) {
            await this.subscribeSymbolsToConnection(i);
          }
      }
    });
  }

  // Belirli bir bağlantıya atanmış sembollere abone olur
  private async subscribeSymbolsToConnection(index: number) {
    if (this.isUpdatingSubscriptions[index]) {
      // DEBUG -> VERBOSE
      this.logger.verbose(`[BYB-SPOT-SUB-${index}] Subscription update already in progress. Skipping this call.`);
      return;
    }
    this.isUpdatingSubscriptions[index] = true;
    // DEBUG -> VERBOSE
    this.logger.verbose(`[BYB-SPOT-SUB-${index}] Starting subscription update process (Lock acquired).`);

      const ws = this.wsPool[index];
      if (!ws || ws.readyState !== WebSocket.OPEN) {
          this.logger.warn(`[BYB-SPOT-SUB-${index}] WS not open, cannot subscribe/unsubscribe.`);
          return;
      }

      // Mevcut abonelikleri al
      const currentSubscriptions = this.subscribedSymbolsPerConnection[index];

      // Bu bağlantı için GEREKEN abonelikleri belirle
      const requiredSymbolsRaw = this.latestSymbolsFromCache
                                    .map(s => `${s}USDT`) // Bybit formatı
                                    .filter(rawSymbol => this.validSpotSymbols.has(rawSymbol)); // Sadece geçerli Spot sembolleri
      
      const requiredTopics = new Set(requiredSymbolsRaw.map(rawSymbol => `tickers.${rawSymbol}`));

      // Eklenecekler
      const topicsToSubscribe = Array.from(requiredTopics).filter(topic => !currentSubscriptions.has(topic));

      // Kaldırılacaklar
      const topicsToUnsubscribe = Array.from(currentSubscriptions).filter(topic => !requiredTopics.has(topic));

    try {
      if (topicsToUnsubscribe.length > 0) {
            this.logger.log(`[BYB-SPOT-UNSUB-${index}] Attempting to unsubscribe from ALL ${topicsToUnsubscribe.length} previous topics...`);
          for (let i = 0; i < topicsToUnsubscribe.length; i += 10) {
              const batch = topicsToUnsubscribe.slice(i, i + 10);
              const unsubscriptionMessage = {
                  op: "unsubscribe",
                  args: batch,
                  req_id: `unsub-all-${index}-${i}-${Date.now()}`
              };
                // DEBUG -> VERBOSE
                this.logger.verbose(`[BYB-SPOT-UNSUB-${index}] Sending UNSUBSCRIBE: ${JSON.stringify(unsubscriptionMessage)}`);
              ws.send(JSON.stringify(unsubscriptionMessage));
                await sleep(250);
            }
            this.logger.log(`[BYB-SPOT-UNSUB-${index}] Finished sending unsubscribe requests. Clearing local state.`);
            this.subscribedSymbolsPerConnection[index].clear();
        } else {
            this.subscribedSymbolsPerConnection[index].clear();
            // DEBUG -> VERBOSE
            this.logger.verbose(`[BYB-SPOT-UNSUB-${index}] No previous subscriptions to unsubscribe from.`);
      }

        // DEBUG -> VERBOSE
        this.logger.verbose(`[BYB-SPOT-SUB-${index}] Waiting 500ms after unsubscribing...`);
        await sleep(500);

      if (topicsToSubscribe.length > 0) {
            this.logger.log(`[BYB-SPOT-SUB-${index}] Attempting to subscribe to ALL ${topicsToSubscribe.length} required topics...`);
          for (let i = 0; i < topicsToSubscribe.length; i += 10) {
              const batch = topicsToSubscribe.slice(i, i + 10);
              const subscriptionMessage = {
                  op: "subscribe",
                  args: batch,
                  req_id: `sub-all-${index}-${i}-${Date.now()}`
              };
                // DEBUG -> VERBOSE
                this.logger.verbose(`[BYB-SPOT-SUB-${index}] Sending SUBSCRIBE: ${JSON.stringify(subscriptionMessage)}`);
              ws.send(JSON.stringify(subscriptionMessage));
              batch.forEach(topic => this.subscribedSymbolsPerConnection[index].add(topic));
                await sleep(250);
          }
            this.logger.log(`[BYB-SPOT-SUB-${index}] Finished sending subscribe requests.`);
        } else {
            this.logger.log(`[BYB-SPOT-SUB-${index}] No topics required for subscription.`);
        }
    } catch (error) {
        this.logger.error(`[BYB-SPOT-SUB-${index}] Error during subscription update process:`, error);
    } finally {
        this.isUpdatingSubscriptions[index] = false;
        // DEBUG -> VERBOSE
        this.logger.verbose(`[BYB-SPOT-SUB-${index}] Subscription update process finished (Lock released). Current local count: ${this.subscribedSymbolsPerConnection[index].size}`);
      }
  }

  private cleanSymbol(rawSymbol: string | undefined | null): string | null {
    if (!rawSymbol) return null;
    let symbol = rawSymbol.toUpperCase().replace(/(\d+X|\d+L|\d+S|PERP)$/, '');
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