import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosResponse } from 'axios';
import { Subject } from 'rxjs';
import {
  BybitApiResponse,
  BybitFundingData,
  BybitTickerItem,
  BybitSpotTickerEvent,
  BybitSpotTickerData,
  BybitFuturesTickerEvent,
  BybitFuturesTickerData,
  BybitTickersResponse
} from './bybit.types';
import { WsConnectionStatus } from '../../common/types/connection-status.types';
import * as WebSocket from 'ws';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class BybitService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BybitService.name);
  private fundingDataSubject = new Subject<BybitFundingData[]>();
  public fundingDataStream$ = this.fundingDataSubject.asObservable();
  private statusSubject = new Subject<WsConnectionStatus>();
  public statusStream$ = this.statusSubject.asObservable();
  private isFetching = false;
  private intervalId: NodeJS.Timeout | null = null;
  private readonly restApiUrl = 'https://api.bybit.com/v5/market/tickers?category=linear';
  
  private spotWs: WebSocket.WebSocket | null = null;
  private isSpotWsConnecting = false;
  private spotWsConnectionAttemptInterval: NodeJS.Timeout | null = null;
  private readonly spotWsUrl = 'wss://stream.bybit.com/v5/public/spot';
  private spotTickerSubject = new Subject<BybitSpotTickerData[]>();
  public spotTickerStream$ = this.spotTickerSubject.asObservable();
  private subscribedSpotSymbols = new Set<string>();
  
  private futuresWs: WebSocket.WebSocket | null = null;
  private isFuturesWsConnecting = false;
  private futuresWsConnectionAttemptInterval: NodeJS.Timeout | null = null;
  private readonly futuresWsUrl = 'wss://stream.bybit.com/v5/public/linear';
  private futuresTickerSubject = new Subject<BybitFuturesTickerData[]>();
  public futuresTickerStream$ = this.futuresTickerSubject.asObservable();
  private subscribedFuturesSymbols = new Set<string>();

  private validSpotSymbols = new Set<string>();
  private validFuturesSymbols = new Set<string>();

  private latestSymbolsFromCache: string[] = [];

  constructor(
    private configService: ConfigService,
    private eventEmitter: EventEmitter2,
  ) {
      // console.log('--- BYBIT SERVICE CONSTRUCTOR IS BEING CALLED ---');
      this.logger.log('BybitService CONSTRUCTOR called.');
  }

  async onModuleInit() {
    this.logger.log('BybitService ON_MODULE_INIT started.');
    this.statusSubject.next('connecting');

    try {
        const testUrl = 'https://api.bybit.com/v5/market/tickers?category=spot&limit=1'; 
        this.logger.log(`[BYB-NETWORK-TEST] Attempting simple GET request to: ${testUrl}`);
        const response = await axios.get(testUrl, { timeout: 5000 }); 
        if (response.status === 200 && response.data?.retCode === 0) {
            this.logger.log(`[BYB-NETWORK-TEST] Successfully received response from Bybit REST API. Network seems OK.`);
        } else {
            this.logger.warn(`[BYB-NETWORK-TEST] Received non-OK response from Bybit REST API. Status: ${response.status}, Body: ${JSON.stringify(response.data)}`);
        }
    } catch (networkError) {
         if (axios.isAxiosError(networkError)) {
             this.logger.error(`[BYB-NETWORK-TEST] Axios Error during network test: ${networkError.message}`, networkError.code);
         } else {
            this.logger.error(`[BYB-NETWORK-TEST] Non-Axios Error during network test: ${networkError.message}`, networkError);
         }
    }

    this.logger.log('[BYB-INIT] Fetching valid Bybit symbols...');
    try {
        await this.fetchBybitSymbols();
        this.logger.log(`[BYB-INIT] Fetched ${this.validSpotSymbols.size} valid spot symbols and ${this.validFuturesSymbols.size} valid futures symbols.`);
    } catch (symbolFetchError) {
        this.logger.error('[BYB-INIT] Failed to fetch valid Bybit symbols on init:', symbolFetchError);
    }

    try {
        this.logger.log('BybitService ON_MODULE_INIT calling fetchData (Funding/OI REST)...');
        await this.fetchData(); 
        this.logger.log('BybitService ON_MODULE_INIT initial fetchData completed.');
    } catch (initError) {
        this.logger.error('BybitService ON_MODULE_INIT error during initial fetchData:', initError);
    }

    this.logger.log('BybitService ON_MODULE_INIT setting interval for fetchData...');
    this.intervalId = setInterval(() => {
         this.logger.log('BybitService INTERVAL triggered. Calling fetchData...');
         this.fetchData();
     }, 300000);
    
    this.logger.log('BybitService ON_MODULE_INIT initiating WebSocket connections...');
    this.connectSpotStream();
    this.connectFuturesStream();
    
    this.listenForSymbolUpdates();
    this.logger.log('BybitService ON_MODULE_INIT finished.');
  }

  onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.logger.log('Cleared Bybit fetch interval.');
    }
    this.statusSubject.next('disconnected');
    this.clearSpotWsConnectionAttemptInterval();
    this.closeSpotStream();
    this.clearFuturesWsConnectionAttemptInterval();
    this.closeFuturesStream();
    this.logger.log('BybitService destroyed. Status set to disconnected.');
  }

  private cleanSymbol(rawSymbol: string | undefined | null): string | null {
    if (!rawSymbol) {
      return null;
    }
    let symbol = rawSymbol.toUpperCase();
    if (!symbol || typeof symbol !== 'string' || symbol.length < 3) {
      return null;
    }
    symbol = symbol.replace(/(\d+X|\d+L|\d+S)$/, '');
    symbol = symbol.replace(/PERP$/, '');
    const validEndings = ['USDT', 'BUSD', 'USDC', 'TUSD'];
    let cleaned = null;
    for (const ending of validEndings) {
      if (symbol.endsWith(ending)) {
        cleaned = symbol.substring(0, symbol.length - ending.length);
        break;
      }
    }
    if (!cleaned || cleaned.length < 1) {
      return null;
    }
    if (cleaned === 'WBT') cleaned = 'WBTC';
    if (/^\d+/.test(cleaned)) {
      cleaned = cleaned.replace(/^\d+/, '');
    }
    if (!cleaned || cleaned.length < 1) {
       return null;
    }
    return cleaned;
  }

  private async fetchData(): Promise<void> {
    this.logger.log('BybitService FETCH_DATA started.');
    if (this.isFetching) {
      this.logger.debug('Bybit fetch already in progress, skipping.');
      return;
    }
    this.isFetching = true;
    this.logger.log('BybitService FETCH_DATA fetching flag set to true.');

    const url = this.restApiUrl;
    this.logger.log(`Attempting to fetch Bybit data from ${url}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        this.logger.warn('Bybit fetch request timed out after 10 seconds.');
        controller.abort();
    }, 10000);
    this.logger.log('BybitService FETCH_DATA timeout set.');

    try {
       this.logger.log('BybitService FETCH_DATA entering try block for axios.get.');
      const https = require('https');
      const agent = new https.Agent({
        rejectUnauthorized: false,
      });

      const response: AxiosResponse<BybitApiResponse> = await axios.get(url, {
         signal: controller.signal,
         headers: { 'Accept': 'application/json' },
         timeout: 10000,
         maxRedirects: 5,
         httpsAgent: agent,
      });
      clearTimeout(timeoutId);
      this.logger.log(`Bybit API Response Status: ${response.status}`);

      if (!response || !response.data) {
          this.logger.error('Error fetching Bybit data: Response or response.data is missing.');
          this.statusSubject.next('error');
          this.isFetching = false;
          return;
      }

      if (response.data.retCode !== 0 || !response.data.result || !response.data.result.list) {
        this.logger.error(
          `Error fetching Bybit data or missing result/list: ${response.data?.retMsg || 'Invalid response structure'} (retCode: ${response.data?.retCode}). Full response: ${JSON.stringify(response.data)}`,
        );
        this.statusSubject.next('error');
        this.isFetching = false;
        return;
      }

      this.logger.log(`Fetched ${response.data.result.list.length} tickers from Bybit for Funding/OI`);
      this.statusSubject.next('connected');

      const fundingData: BybitFundingData[] = response.data.result.list
        .map((item: BybitTickerItem) => {
          const cleanedSymbol = this.cleanSymbol(item.symbol);
          if (!cleanedSymbol) {
            return null;
          }
          const fundingRateNum = item.fundingRate ? parseFloat(item.fundingRate) : undefined;
          const openInterestValueNum = item.openInterestValue ? parseFloat(item.openInterestValue) : undefined;

          return {
            symbol: cleanedSymbol,
            fundingRate: isNaN(fundingRateNum) ? undefined : fundingRateNum,
            openInterestValue: isNaN(openInterestValueNum) ? undefined : openInterestValueNum,
          };
        })
        .filter(item => item !== null && (item.fundingRate !== undefined || item.openInterestValue !== undefined));

      this.logger.log(`Processed ${fundingData.length} valid Bybit funding/OI entries after cleaning and filtering.`);

      if (fundingData.length > 0) {
        this.publishFundingData(fundingData);
        this.logger.log(`Published ${fundingData.length} Bybit funding/OI updates.`);
      } else {
        this.logger.warn('No valid Bybit funding data to publish after cleaning and filtering.');
      }
    } catch (error) {
       clearTimeout(timeoutId);
       this.logger.error('BybitService FETCH_DATA entered CATCH block.');
      if (axios.isAxiosError(error)) {
         this.logger.error(`Axios error fetching Bybit data: ${error.message}`, error.code === 'ECONNABORTED' ? 'Request timed out' : error.stack);
         if (error.response) {
             this.logger.error(`Error Response Status: ${error.response.status}`);
             this.logger.error(`Error Response Data: ${JSON.stringify(error.response.data)}`);
         } else if (error.request) {
             this.logger.error('Error Request: No response received or request aborted.');
         }
      } else {
         this.logger.error(`Non-Axios error fetching Bybit data: ${error.message}`, error.stack);
      }
      this.statusSubject.next('error');
    } finally {
       this.logger.log('BybitService FETCH_DATA entered FINALLY block.');
       this.isFetching = false;
       this.logger.log('BybitService FETCH_DATA fetching flag set to false.');
    }
    this.logger.log('BybitService FETCH_DATA finished.');
  }

   private publishFundingData(data: BybitFundingData[]): void {
     this.logger.log(`BybitService PUBLISH_FUNDING_DATA called with ${data?.length ?? 0} items.`);
    if (data && data.length > 0) {
      this.logger.debug(`####### BybitService publishFundingData: Publishing ${data.length} items #######`);
      this.fundingDataSubject.next(data);
      this.logger.log(`BybitService PUBLISH_FUNDING_DATA subject.next called.`);
    } else {
       this.logger.warn('Attempted to publish empty or invalid Bybit funding data.');
    }
  }

  public getCurrentStatus(): WsConnectionStatus {
    let status: WsConnectionStatus = 'disconnected';
    const subscription = this.statusStream$.subscribe(s => status = s);
    subscription.unsubscribe();
    return status;
  }

  private connectSpotStream() {
    if (this.spotWs || this.isSpotWsConnecting) {
      this.logger.warn('[BYB-SPOT-CONN] Bybit Spot WebSocket connection already established or in progress.');
      return;
    }
    this.isSpotWsConnecting = true; 
    
    this.logger.log(`[BYB-SPOT-CONN] Attempting to connect...`); 

    this.logger.log(`[BYB-SPOT-CONN] Preparing to create new WebSocket instance for ${this.spotWsUrl}`);
    try { 
        this.spotWs = new WebSocket(this.spotWsUrl);
        this.logger.log(`[BYB-SPOT-CONN] Successfully created WebSocket instance. Adding listeners...`);
    } catch (wsError) {
        // console.error('--- ERROR creating SPOT WebSocket ---', wsError); 
        this.logger.error(`[BYB-SPOT-CONN] !!! FAILED to create WebSocket instance: ${wsError.message}`, wsError.stack);
        this.isSpotWsConnecting = false; 
        this.handleSpotWsDisconnect(); 
        return; 
    }

    this.spotWs.on('open', () => {
      this.isSpotWsConnecting = false;
      this.logger.log('[BYB-SPOT-CONN] Bybit Spot WebSocket connection established.');
      this.clearSpotWsConnectionAttemptInterval();
      
      // this.subscribeToSpotTickers(); // Cache update gelene kadar bunu çağırma
      this.startSpotWsPing();
    });

    this.spotWs.on('message', (data: WebSocket.RawData) => {
      // console.log(`--- SPOT WS MESSAGE RECEIVED --- Data: ${data.toString().substring(0, 100)}...`); // KALDIRILDI
      try {
        const message = JSON.parse(data.toString());
        
        if (message.op === 'pong') {
           this.logger.verbose('[BYB-SPOT-MSG] Received pong.');
          return; 
        }
        
        if (message.op === 'subscribe') {
          if (message.success) {
            this.logger.log(`[BYB-SPOT-MSG] Successfully subscribed to Bybit Spot topics: ${message.args?.join(', ')}`);
          } else {
            const failedArgs = message.req_id ? `(ReqID: ${message.req_id})` : (message.args ? `(Args: ${message.args.join(', ')})` : '(Args: N/A)'); 
            this.logger.error(`[BYB-SPOT-MSG] Failed to subscribe to Bybit Spot topics: ${message.ret_msg} ${failedArgs}`);
          }
          return;
        }
        
        if (message.topic && message.topic.startsWith('tickers.') && message.data) {
          const event = message as BybitSpotTickerEvent;
          const cleanedSymbol = this.cleanSymbol(event.data.symbol); 
          if (cleanedSymbol) {
             if (cleanedSymbol === 'BTC') {
                 this.logger.warn(`[BYB-SPOT-MSG BTC TICKER RAW]: ${JSON.stringify(event.data)}`);
             }
            const dataToSend: BybitSpotTickerData = { ...event.data, symbol: cleanedSymbol }; 
            this.spotTickerSubject.next([dataToSend]);
            if (cleanedSymbol === 'BTC') {
                this.logger.warn(`[BYB-SPOT-MSG BTC TICKER PROCESSED]: Publishing BTC Spot ticker. Original: ${event.data.symbol}, Cleaned: ${cleanedSymbol}, Price: ${dataToSend.lastPrice}`);
             }
          } else {
            // this.logger.debug(`Bybit Spot Ticker symbol ${event.data.symbol} cleaned to null, skipping.`);
          }
        } else {
          // this.logger.debug('[BYB-SPOT-MSG] Received non-ticker message from Bybit Spot WS:', message);
        }
      } catch (error) {
        this.logger.error(`[BYB-SPOT-MSG] Failed to parse Bybit Spot WebSocket message: ${data.toString()}`, error);
      }
    });

    this.spotWs.on('error', (error: Error) => {
      this.isSpotWsConnecting = false;
      this.logger.error(`[BYB-SPOT-CONN] WebSocket 'error' event received:`, error);
      this.handleSpotWsDisconnect();
    });

    this.spotWs.on('close', (code: number, reason: Buffer) => {
      const reasonString = reason ? reason.toString() : 'No reason provided';
      this.logger.log(`[BYB-SPOT-CONN] WebSocket 'close' event received. Code: ${code}, Reason: "${reasonString}"`);
      this.isSpotWsConnecting = false;
      
      if (code !== 1000) { 
        this.logger.warn(`[BYB-SPOT-CONN] Unexpected close code ${code}. Reason: ${reasonString}. Attempting reconnect...`);
        this.handleSpotWsDisconnect();
      } else {
        this.logger.log(`[BYB-SPOT-CONN] Spot WebSocket closed normally (code 1000). Reason: ${reasonString}`);
      }
      this.spotWs = null;
      this.subscribedSpotSymbols.clear();
      this.stopSpotWsPing();
    });
  }
  
  private async subscribeToSpotTickers() {
    if (this.spotWs?.readyState === WebSocket.OPEN) {
       const symbolsFromCache = this.latestSymbolsFromCache.length > 0 
           ? this.latestSymbolsFromCache.map(s => `${s}USDT`)
           : [];
           
       if (this.validSpotSymbols.size === 0) {
            this.logger.warn('[BYB-SPOT-SUB] Valid spot symbol list is empty, cannot subscribe.');
            return;
       }

       const validSymbolsToSubscribe = symbolsFromCache.filter(s => this.validSpotSymbols.has(s));

       this.logger.log(`[BYB-SPOT-SUB] Cache has ${symbolsFromCache.length} potential symbols. Found ${validSymbolsToSubscribe.length} valid Spot symbols on Bybit.`);

       if (validSymbolsToSubscribe.length === 0) {
           this.logger.warn('[BYB-SPOT-SUB] No valid spot symbols found from current cache to subscribe.');
           return;
       }
        
       const topics = validSymbolsToSubscribe.map(s => `tickers.${s}`); 
      
       const batchSize = 10;
       this.logger.log(`[BYB-SPOT-SUB] Preparing to send ${topics.length} spot topics in batches of ${batchSize}.`);
       
       this.subscribedSpotSymbols.clear(); 

       for (let i = 0; i < topics.length; i += batchSize) {
           const batch = topics.slice(i, i + batchSize);
           const subscriptionMessage = { 
               op: "subscribe", 
               args: batch,
           };
           this.logger.log(`--- Sending SPOT subscription (Batch ${i/batchSize + 1}/${Math.ceil(topics.length/batchSize)}): ${JSON.stringify(subscriptionMessage)} ---`);
           this.spotWs.send(JSON.stringify(subscriptionMessage));
           batch.forEach(topic => this.subscribedSpotSymbols.add(topic.split('.')[1]));
           await this.sleep(150);
       }
       this.logger.log(`[BYB-SPOT-SUB] Sent all subscription requests. Current subscribed symbols set size (assumed): ${this.subscribedSpotSymbols.size}`);

    } else {
        this.logger.warn('[BYB-SPOT-SUB] Cannot subscribe to Bybit Spot WS, connection not open.');
    }
  }
  
  private handleSpotWsDisconnect() {
    this.logger.warn('[BYB-SPOT-RECONN] Handling Spot WS disconnect.');
    this.closeSpotStream(false);
    this.scheduleSpotWsReconnection();
  }

  private scheduleSpotWsReconnection() {
    if (this.spotWsConnectionAttemptInterval || this.isSpotWsConnecting || (this.spotWs && this.spotWs.readyState === WebSocket.OPEN)) {
       this.logger.log('[BYB-SPOT-RECONN] Spot reconnect already scheduled, connecting or connected.');
       return;
    }
    const reconnectDelay = 5000 + Math.random() * 2000;
    this.logger.log(`[BYB-SPOT-RECONN] Scheduling Bybit Spot WS reconnection in ${(reconnectDelay / 1000).toFixed(1)}s...`);
    this.spotWsConnectionAttemptInterval = setTimeout(() => {
      this.spotWsConnectionAttemptInterval = null;
      if (!this.spotWs || this.spotWs.readyState === WebSocket.CLOSED) {
         this.logger.log('[BYB-SPOT-RECONN] Attempting Spot reconnect now...');
        this.connectSpotStream();
      } else {
         this.logger.log('[BYB-SPOT-RECONN] Spot WS is open or connecting, skipping reconnect attempt.');
      }
    }, reconnectDelay);
  }

  private clearSpotWsConnectionAttemptInterval() {
    if (this.spotWsConnectionAttemptInterval) {
      clearTimeout(this.spotWsConnectionAttemptInterval);
      this.spotWsConnectionAttemptInterval = null;
      this.logger.log('[BYB-SPOT-RECONN] Cleared scheduled spot reconnect attempt.');
    }
  }
  
  private spotWsPingInterval: NodeJS.Timeout | null = null;
  private startSpotWsPing() {
      this.stopSpotWsPing();
      this.logger.log('[BYB-SPOT-PING] Starting Spot WS ping interval (20s).');
      this.spotWsPingInterval = setInterval(() => {
          if (this.spotWs?.readyState === WebSocket.OPEN) {
              this.spotWs.send(JSON.stringify({ op: 'ping', req_id: `spot_ping_${Date.now()}` }));
          } else {
              this.logger.warn('[BYB-SPOT-PING] Cannot send ping to Bybit Spot WS, connection not open. Stopping ping and handling disconnect.');
              this.stopSpotWsPing();
              this.handleSpotWsDisconnect(); 
          }
      }, 20000);
  }
  
  private stopSpotWsPing() {
      if (this.spotWsPingInterval) {
          clearInterval(this.spotWsPingInterval);
          this.spotWsPingInterval = null;
          this.logger.log('[BYB-SPOT-PING] Stopped Bybit Spot WS ping interval.');
      }
  }

  private closeSpotStream(log = true) {
    this.stopSpotWsPing();
    this.clearSpotWsConnectionAttemptInterval();
    if (this.spotWs) {
      if (log) this.logger.log('[BYB-SPOT-CONN] Closing Bybit Spot WebSocket connection.');
      this.spotWs.removeAllListeners();
      this.spotWs.terminate();
      this.spotWs = null;
      this.subscribedSpotSymbols.clear();
    }
    this.isSpotWsConnecting = false;
  }

  private connectFuturesStream() {
    if (this.futuresWs || this.isFuturesWsConnecting) {
      this.logger.warn('[BYB-FUT-CONN] Bybit Futures WebSocket connection already established or in progress.');
      return;
    }
    this.isFuturesWsConnecting = true;
    
    this.logger.log(`[BYB-FUT-CONN] Attempting to connect...`); 
    
    this.logger.log(`[BYB-FUT-CONN] Preparing to create new WebSocket instance for ${this.futuresWsUrl}`);
    try { 
        this.futuresWs = new WebSocket(this.futuresWsUrl);
        this.logger.log(`[BYB-FUT-CONN] Successfully created WebSocket instance. Adding listeners...`);
    } catch (wsError) {
        // console.error('--- ERROR creating FUTURES WebSocket ---', wsError); 
        this.logger.error(`[BYB-FUT-CONN] !!! FAILED to create WebSocket instance: ${wsError.message}`, wsError.stack);
        this.isFuturesWsConnecting = false; 
        this.handleFuturesWsDisconnect(); 
        return; 
    }

    this.futuresWs.on('open', () => {
      this.isFuturesWsConnecting = false;
      this.logger.log('[BYB-FUT-CONN] Bybit Futures WebSocket connection established.');
      this.clearFuturesWsConnectionAttemptInterval();

      // this.subscribeToFuturesTickers(); // Cache update gelene kadar bunu çağırma
      this.startFuturesWsPing();
    });

    this.futuresWs.on('message', (data: WebSocket.RawData) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.op === 'pong') {
           this.logger.verbose('[BYB-FUT-MSG] Received pong.');
           return;
        }
        if (message.op === 'subscribe') {
          if (message.success) {
            this.logger.log(`[BYB-FUT-MSG] Successfully subscribed to Bybit Futures topics: ${message.args?.join(', ')}`);
          } else {
             const failedArgs = message.req_id ? `(ReqID: ${message.req_id})` : (message.args ? `(Args: ${message.args.join(', ')})` : '(Args: N/A)'); 
             this.logger.error(`[BYB-FUT-MSG] Failed to subscribe to Bybit Futures topics: ${message.ret_msg} ${failedArgs}`);
           }
           return;
         }
        
        if (message.topic && message.topic.startsWith('tickers.') && message.data) {
          const event = message as BybitFuturesTickerEvent;
          const cleanedSymbol = this.cleanSymbol(event.data.symbol);
          if (cleanedSymbol) {
             if (cleanedSymbol === 'BTC') {
                 this.logger.warn(`[BYB-FUT-MSG BTC TICKER RAW]: ${JSON.stringify(event.data)}`);
             }
            const dataToSend: BybitFuturesTickerData = { ...event.data, symbol: cleanedSymbol }; 
            this.futuresTickerSubject.next([dataToSend]);
             if (cleanedSymbol === 'BTC') {
                this.logger.warn(`[BYB-FUT-MSG BTC TICKER PROCESSED]: Publishing BTC Futures ticker. Original: ${event.data.symbol}, Cleaned: ${cleanedSymbol}, Price: ${dataToSend.lastPrice}`);
             }
          }
        } else {
            // this.logger.debug('[BYB-FUT-MSG] Received non-ticker message from Bybit Futures WS:', message);
        }
      } catch (error) {
        this.logger.error(`[BYB-FUT-MSG] Failed to parse Bybit Futures WebSocket message: ${data.toString()}`, error);
      }
    });

    this.futuresWs.on('error', (error: Error) => {
      this.isFuturesWsConnecting = false;
      this.logger.error(`[BYB-FUT-CONN] WebSocket 'error' event received:`, error);
      this.handleFuturesWsDisconnect();
    });

    this.futuresWs.on('close', (code: number, reason: Buffer) => {
       const reasonString = reason ? reason.toString() : 'No reason provided';
       this.logger.log(`[BYB-FUT-CONN] WebSocket 'close' event received. Code: ${code}, Reason: "${reasonString}"`);
       this.isFuturesWsConnecting = false;
       
       if (code !== 1000) { 
         this.logger.warn(`[BYB-FUT-CONN] Unexpected close code ${code}. Reason: ${reasonString}. Attempting reconnect...`);
         this.handleFuturesWsDisconnect();
       } else {
         this.logger.log(`[BYB-FUT-CONN] Futures WebSocket closed normally (code 1000). Reason: ${reasonString}`);
       }
       this.futuresWs = null;
       this.subscribedFuturesSymbols.clear();
       this.stopFuturesWsPing();
    });
  }

  private async subscribeToFuturesTickers() {
    if (this.futuresWs?.readyState === WebSocket.OPEN) {
       const symbolsFromCache = this.latestSymbolsFromCache.length > 0 
           ? this.latestSymbolsFromCache.map(s => `${s}USDT`)
           : [];
           
       if (this.validFuturesSymbols.size === 0) {
           this.logger.warn('[BYB-FUT-SUB] Valid futures symbol list is empty, cannot subscribe.');
           return;
       }

       const validSymbolsToSubscribe = symbolsFromCache.filter(s => this.validFuturesSymbols.has(s));

       this.logger.log(`[BYB-FUT-SUB] Cache has ${symbolsFromCache.length} potential symbols. Found ${validSymbolsToSubscribe.length} valid Linear Futures symbols on Bybit.`);

       if (validSymbolsToSubscribe.length === 0) {
           this.logger.warn('[BYB-FUT-SUB] No valid linear futures symbols found from current cache to subscribe.');
           return; 
       }
        
       const topics = validSymbolsToSubscribe.map(s => `tickers.${s}`); 
      
       const batchSize = 10; 
       this.logger.log(`[BYB-FUT-SUB] Preparing to send ${topics.length} future topics in batches of ${batchSize}.`);
       
       this.subscribedFuturesSymbols.clear();

       for (let i = 0; i < topics.length; i += batchSize) {
           const batch = topics.slice(i, i + batchSize);
           const subscriptionMessage = { 
               op: "subscribe", 
               args: batch,
           };
           this.logger.log(`--- Sending FUTURES subscription (Batch ${i/batchSize + 1}/${Math.ceil(topics.length/batchSize)}): ${JSON.stringify(subscriptionMessage)} ---`);
           this.futuresWs.send(JSON.stringify(subscriptionMessage));
           batch.forEach(topic => this.subscribedFuturesSymbols.add(topic.split('.')[1]));
           await this.sleep(150);
       }
       this.logger.log(`[BYB-FUT-SUB] Sent all subscription requests. Current subscribed symbols set size (assumed): ${this.subscribedFuturesSymbols.size}`);

    } else {
        this.logger.warn('[BYB-FUT-SUB] Cannot subscribe to Bybit Futures WS, connection not open.');
    }
  }
  
  private handleFuturesWsDisconnect() {
    this.logger.warn('[BYB-FUT-RECONN] Handling Futures WS disconnect.');
    this.closeFuturesStream(false);
    this.scheduleFuturesWsReconnection();
  }

  private scheduleFuturesWsReconnection() {
    if (this.futuresWsConnectionAttemptInterval || this.isFuturesWsConnecting || (this.futuresWs && this.futuresWs.readyState === WebSocket.OPEN)) {
       this.logger.log('[BYB-FUT-RECONN] Futures reconnect already scheduled, connecting or connected.');
       return;
    }
    const reconnectDelay = 5000 + Math.random() * 2000;
    this.logger.log(`[BYB-FUT-RECONN] Scheduling Bybit Futures WS reconnection in ${(reconnectDelay / 1000).toFixed(1)}s...`);
    this.futuresWsConnectionAttemptInterval = setTimeout(() => {
      this.futuresWsConnectionAttemptInterval = null;
      if (!this.futuresWs || this.futuresWs.readyState === WebSocket.CLOSED) {
         this.logger.log('[BYB-FUT-RECONN] Attempting Futures reconnect now...');
        this.connectFuturesStream();
      } else {
          this.logger.log('[BYB-FUT-RECONN] Futures WS is open or connecting, skipping reconnect attempt.');
      }
    }, reconnectDelay);
  }

  private clearFuturesWsConnectionAttemptInterval() {
    if (this.futuresWsConnectionAttemptInterval) {
      clearTimeout(this.futuresWsConnectionAttemptInterval);
      this.futuresWsConnectionAttemptInterval = null;
      this.logger.log('[BYB-FUT-RECONN] Cleared scheduled futures reconnect attempt.');
    }
  }
  
  private futuresWsPingInterval: NodeJS.Timeout | null = null;
  private startFuturesWsPing() {
      this.stopFuturesWsPing();
      this.logger.log('[BYB-FUT-PING] Starting Futures WS ping interval (20s).');
      this.futuresWsPingInterval = setInterval(() => {
          if (this.futuresWs?.readyState === WebSocket.OPEN) {
              this.futuresWs.send(JSON.stringify({ op: 'ping', req_id: `fut_ping_${Date.now()}` }));
          } else {
              this.logger.warn('[BYB-FUT-PING] Cannot send ping to Bybit Futures WS, connection not open. Stopping ping and handling disconnect.');
              this.stopFuturesWsPing();
              this.handleFuturesWsDisconnect();
          }
      }, 20000);
  }
  
  private stopFuturesWsPing() {
      if (this.futuresWsPingInterval) {
          clearInterval(this.futuresWsPingInterval);
          this.futuresWsPingInterval = null;
          this.logger.log('[BYB-FUT-PING] Stopped Bybit Futures WS ping interval.');
      }
  }

  private closeFuturesStream(log = true) {
    this.stopFuturesWsPing();
    this.clearFuturesWsConnectionAttemptInterval();
    if (this.futuresWs) {
      if (log) this.logger.log('[BYB-FUT-CONN] Closing Bybit Futures WebSocket connection.');
      this.futuresWs.removeAllListeners();
      this.futuresWs.terminate();
      this.futuresWs = null;
      this.subscribedFuturesSymbols.clear();
    }
    this.isFuturesWsConnecting = false;
  }

  private listenForSymbolUpdates() {
    this.logger.log('[BYB-SYMBOL-UPDATE] Listening for cache.symbols.updated events...');
    this.eventEmitter.on('cache.symbols.updated', async (symbols: string[]) => {
      this.logger.log(`[BYB-SYMBOL-UPDATE] Received ${symbols.length} symbols from cache event.`);
      
      const newSymbolsBase = symbols.filter(s => s && typeof s === 'string');
      
      const previousSymbolsString = JSON.stringify([...this.latestSymbolsFromCache].sort());
      const newSymbolsString = JSON.stringify([...newSymbolsBase].sort());

      if (previousSymbolsString === newSymbolsString) {
          this.logger.log('[BYB-SYMBOL-UPDATE] Symbol list unchanged, skipping subscription updates.');
          return;
      }

      this.logger.log('[BYB-SYMBOL-UPDATE] Symbol list changed. Updating internal list and triggering resubscription check.');
      this.latestSymbolsFromCache = newSymbolsBase;

      if (this.spotWs?.readyState === WebSocket.OPEN) {
          this.logger.log('[BYB-SYMBOL-UPDATE] Spot WS open, re-checking/updating subscriptions...');
          await this.subscribeToSpotTickers();
      } else {
          this.logger.warn('[BYB-SYMBOL-UPDATE] Spot WS not open, cannot update subscriptions.');
      }

      if (this.futuresWs?.readyState === WebSocket.OPEN) {
           this.logger.log('[BYB-SYMBOL-UPDATE] Futures WS open, re-checking/updating subscriptions...');
           await this.subscribeToFuturesTickers();
      } else {
           this.logger.warn('[BYB-SYMBOL-UPDATE] Futures WS not open, cannot update subscriptions.');
      }
    });
  }

  private unsubscribeSpotTickers(symbols: string[]) {
    if (this.spotWs?.readyState === WebSocket.OPEN) {
      if (!symbols || symbols.length === 0) return;
      const args = symbols.map(s => `tickers.${s}`);
      const unsubscriptionMessage = { op: "unsubscribe", args: args };
      this.spotWs.send(JSON.stringify(unsubscriptionMessage));
      this.logger.log(`[BYB-SPOT-UNSUB] Sent unsubscription request to Bybit Spot WS: ${JSON.stringify(args)}`);
      symbols.forEach(s => this.subscribedSpotSymbols.delete(s));
    } else {
      this.logger.warn('[BYB-SPOT-UNSUB] Cannot unsubscribe from Bybit Spot WS, connection not open.');
    }
  }

  private unsubscribeFuturesTickers(symbols: string[]) {
    if (this.futuresWs?.readyState === WebSocket.OPEN) {
       if (!symbols || symbols.length === 0) return;
      const args = symbols.map(s => `tickers.${s}`);
      const unsubscriptionMessage = { op: "unsubscribe", args: args };
      this.futuresWs.send(JSON.stringify(unsubscriptionMessage));
      this.logger.log(`[BYB-FUT-UNSUB] Sent unsubscription request to Bybit Futures WS: ${JSON.stringify(args)}`);
      symbols.forEach(s => this.subscribedFuturesSymbols.delete(s));
    } else {
      this.logger.warn('[BYB-FUT-UNSUB] Cannot unsubscribe from Bybit Futures WS, connection not open.');
    }
  }

  private async fetchBybitSymbols(): Promise<void> {
    const spotUrl = 'https://api.bybit.com/v5/market/tickers?category=spot&limit=1000';
    const linearUrl = 'https://api.bybit.com/v5/market/tickers?category=linear&limit=1000';
    const timeout = 10000;

    try {
      this.logger.log(`[BYB-SYMBOLS] Fetching Spot symbols from ${spotUrl}`);
      const spotResponse: AxiosResponse<BybitTickersResponse> = await axios.get(spotUrl, { timeout });
      if (spotResponse.data && spotResponse.data.retCode === 0 && spotResponse.data.result?.list) {
        this.validSpotSymbols = new Set(spotResponse.data.result.list.map(item => item.symbol));
        this.logger.log(`[BYB-SYMBOLS] Successfully fetched ${this.validSpotSymbols.size} spot symbols.`);
      } else {
        this.logger.error(`[BYB-SYMBOLS] Failed to fetch Spot symbols or invalid response: ${spotResponse.data?.retMsg || 'Error'} (Code: ${spotResponse.data?.retCode})`);
      }
    } catch (error) {
      this.logger.error(`[BYB-SYMBOLS] Error fetching Spot symbols: ${error.message}`, error.stack);
    }

    try {
      this.logger.log(`[BYB-SYMBOLS] Fetching Linear Futures symbols from ${linearUrl}`);
      const linearResponse: AxiosResponse<BybitTickersResponse> = await axios.get(linearUrl, { timeout });
      if (linearResponse.data && linearResponse.data.retCode === 0 && linearResponse.data.result?.list) {
        this.validFuturesSymbols = new Set(linearResponse.data.result.list.map(item => item.symbol));
         this.logger.log(`[BYB-SYMBOLS] Successfully fetched ${this.validFuturesSymbols.size} linear futures symbols.`);
      } else {
        this.logger.error(`[BYB-SYMBOLS] Failed to fetch Linear Futures symbols or invalid response: ${linearResponse.data?.retMsg || 'Error'} (Code: ${linearResponse.data?.retCode})`);
      }
    } catch (error) {
      this.logger.error(`[BYB-SYMBOLS] Error fetching Linear Futures symbols: ${error.message}`, error.stack);
    }
  }

  private sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

} 