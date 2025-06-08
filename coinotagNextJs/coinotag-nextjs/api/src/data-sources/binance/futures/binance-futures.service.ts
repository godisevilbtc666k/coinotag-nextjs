import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import * as WebSocket from 'ws';
import { Subject, Subscription, firstValueFrom } from 'rxjs';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Interval } from '@nestjs/schedule';
import {
  BinanceFuturesFundingRate,
  BinanceFuturesOpenInterest,
  BinanceFuturesTicker,
} from './binance-futures.types';
import { WsConnectionStatus } from '../../../common/types/connection-status.types';
import axios, { AxiosError, AxiosResponse } from 'axios';

@Injectable()
export class BinanceFuturesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BinanceFuturesService.name);
  private readonly futuresWsUrl = 'wss://fstream.binance.com';
  private tickerWs: WebSocket.WebSocket | null = null;
  private tickerConnectionState: WsConnectionStatus = 'disconnected';

  // Subjects for data streams
  private futuresTickerSubject = new Subject<BinanceFuturesTicker[]>();
  private fundingRateSubject = new Subject<BinanceFuturesFundingRate[]>();
  private openInterestSubject = new Subject<BinanceFuturesOpenInterest[]>();

  // Public Observables
  public futuresTickerStream$ = this.futuresTickerSubject.asObservable();
  public fundingRateStream$ = this.fundingRateSubject.asObservable();
  public openInterestStream$ = this.openInterestSubject.asObservable();

  private readonly restBaseUrl = 'https://fapi.binance.com'; // Futures API base URL
  private lastTickerLogTime = 0; // Debug log throttling için

  constructor(
    private configService: ConfigService,
    private httpService: HttpService,
    private eventEmitter: EventEmitter2,
  ) {}

  onModuleInit() {
    this.logger.log('####### BinanceFuturesService onModuleInit CALLED #######');
    this.logger.log('Initializing Binance Futures Service...');
    this.connectTickerStream();
    
    // İlk veri çekimi
    this.fetchAndEmitFundingRates();
    this.fetchAndEmitOpenInterest();
  }

  onModuleDestroy() {
    this.logger.log('Closing Binance Futures Service connections...');
    this.tickerWs?.terminate();
    this.eventEmitter.removeAllListeners('cache.symbols.updated');
  }

  // --- Connection Methods ---
  private connectTickerStream() {
    const url = `${this.futuresWsUrl}/ws/!ticker@arr`;
    this.tickerWs = this.connectWebSocket(
      url,
      'Futures Ticker',
      this.tickerConnectionState,
      this.handleTickerMessage.bind(this),
      this.handleTickerClose.bind(this)
    );
  }

  private connectWebSocket(url: string, streamName: string, connectionState: WsConnectionStatus, onMessage: (data: WebSocket.RawData) => void, onClose: (url: string) => void): WebSocket.WebSocket | null {
    if (this.tickerWs || connectionState === 'connecting') {
      this.logger.warn(`[${streamName} WS] Connection attempt skipped, already exists or connecting.`);
      return null;
    }

    this.tickerConnectionState = 'connecting';
    this.logger.log(`[${streamName} WS] Attempting to connect to ${url}...`);

    try {
      const ws = new WebSocket(url);

      ws.on('open', () => {
        this.logger.log(`[${streamName} WS] Connection established.`);
        this.tickerConnectionState = 'connected';
        this.clearFuturesTickerConnectionAttemptInterval();
      });

      ws.on('message', onMessage);
      ws.on('error', (error: Error) => {
        this.logger.error(`[${streamName} WS] Error:`, error);
        this.handleFuturesTickerDisconnect();
      });
      ws.on('close', (code: number, reason: Buffer) => {
        this.logger.warn(`[${streamName} WS] Closed. Code: ${code}, Reason: ${reason.toString()}.`);
        this.handleFuturesTickerDisconnect();
      });

      return ws;
    } catch (error) {
      this.logger.error(`[${streamName} WS] Connection failed:`, error);
      this.tickerConnectionState = 'error';
      return null;
    }
  }

  private handleTickerMessage(data: WebSocket.RawData) {
    try {
      const message = JSON.parse(data.toString());
      if (Array.isArray(message) && message.length > 0 && message[0].e === '24hrTicker') {
        const filteredMessage = message.filter((item: any) => item.s && item.s.endsWith('USDT'));
        if (filteredMessage.length > 0) {
          // 10 saniyede bir özet log (DEBUG - kaldırıldı)
          const now = Date.now();
          if (now - this.lastTickerLogTime > 10000) {
            // this.logger.debug(`[Futures Ticker WS] Processed ${filteredMessage.length} futures tickers (logged every 10s)`);
            this.lastTickerLogTime = now;
          }
          
          this.futuresTickerSubject.next(filteredMessage as BinanceFuturesTicker[]);
        }
      } else {
        this.logger.debug('[Futures Ticker WS] Received non-ticker array or unknown message type.');
      }
    } catch (error) {
      this.logger.error('[Futures Ticker WS] Error parsing message:', error);
    }
  }

  private handleTickerClose(url: string) {
    this.logger.warn(`[Futures Ticker WS] Connection closed for ${url}.`);
    this.handleFuturesTickerDisconnect();
  }

  private handleFuturesTickerDisconnect() {
    this.tickerConnectionState = 'disconnected';
    this.closeFuturesTickerConnection(false);
    this.scheduleFuturesTickerReconnection();
  }

  private futuresTickerConnectionAttemptInterval: NodeJS.Timeout | null = null;
  private scheduleFuturesTickerReconnection() {
    this.clearFuturesTickerConnectionAttemptInterval();
    if (this.tickerConnectionState === 'connecting' || this.tickerWs) return;
    const reconnectDelay = 5000;
    this.logger.log(`[Futures Ticker WS] Scheduling reconnection in ${reconnectDelay / 1000}s...`);
    this.futuresTickerConnectionAttemptInterval = setTimeout(() => {
      this.futuresTickerConnectionAttemptInterval = null;
      this.logger.log('[Futures Ticker WS] Attempting reconnect now...');
      this.connectTickerStream();
    }, reconnectDelay);
  }

  private clearFuturesTickerConnectionAttemptInterval() {
    if (this.futuresTickerConnectionAttemptInterval) {
      clearTimeout(this.futuresTickerConnectionAttemptInterval);
      this.futuresTickerConnectionAttemptInterval = null;
      this.logger.log('[Futures Ticker WS] Cleared pending reconnection attempt.');
    }
  }

  private closeFuturesTickerConnection(log = true) {
    this.clearFuturesTickerConnectionAttemptInterval();
    if (this.tickerWs) {
      if (log) this.logger.log('[Futures Ticker WS] Closing connection.');
      this.tickerWs.removeAllListeners();
      this.tickerWs.terminate();
      this.tickerWs = null;
      this.tickerConnectionState = 'disconnected';
    }
  }

  // --- Funding Rate REST Endpoint ---
  async fetchFundingRates(): Promise<BinanceFuturesFundingRate[]> {
    try {
      const response = await firstValueFrom(this.httpService.get(`${this.restBaseUrl}/fapi/v1/premiumIndex`));
      return response?.data
        ?.filter((item: any) => item.symbol && item.symbol.endsWith('USDT'))
        ?.map((item: any) => ({
                    symbol: item.symbol,
          markPrice: parseFloat(item.markPrice) || 0,
          fundingRate: parseFloat(item.lastFundingRate) || 0,
          fundingTime: item.nextFundingTime?.toString() || Date.now().toString(),
        })) || [];
    } catch (error) {
      this.logger.error('Error fetching funding rates from REST API:', error);
      return [];
    }
  }

  // --- Open Interest REST Endpoint ---
  async fetchOpenInterest(): Promise<BinanceFuturesOpenInterest[]> {
    try {
      // Önce tüm aktif futures sembollerini al
      const exchangeInfoResponse = await firstValueFrom(
        this.httpService.get(`${this.restBaseUrl}/fapi/v1/exchangeInfo`)
      );
      
      if (!exchangeInfoResponse?.data?.symbols) {
        this.logger.warn('Could not fetch exchange info for open interest');
        return [];
      }

      // Sadece USDT perpetual kontratları al
      const usdtSymbols = exchangeInfoResponse.data.symbols
        .filter((s: any) => 
          s.symbol.endsWith('USDT') && 
          s.status === 'TRADING' &&
          s.contractType === 'PERPETUAL'
        )
        .map((s: any) => s.symbol)
        .slice(0, 100); // İlk 100 sembol (rate limit için)

      this.logger.debug(`[OI] Fetching open interest for ${usdtSymbols.length} USDT perpetual symbols`);

      const openInterestPromises = usdtSymbols.map(async (symbol: string) => {
        try {
          const response = await firstValueFrom(
            this.httpService.get(`${this.restBaseUrl}/fapi/v1/openInterest?symbol=${symbol}`)
          );
          return {
            symbol: response.data.symbol,
            openInterest: response.data.openInterest || '0',
            time: response.data.time || Date.now()
          };
        } catch (error) {
          // Rate limit veya symbol hatası olursa sessizce geç
          return null;
        }
      });

      // Promise.allSettled kullan ki bazı hatalar tüm işlemi durdurmasın
      const results = await Promise.allSettled(openInterestPromises);
      
      const openInterestData = results
        .filter((result): result is PromiseFulfilledResult<any> => 
          result.status === 'fulfilled' && result.value !== null
        )
        .map(result => result.value);

      this.logger.debug(`[OI] Successfully fetched ${openInterestData.length} open interest entries`);
      return openInterestData;
      
    } catch (error) {
      this.logger.error('Error fetching open interest from REST API:', error);
      return [];
    }
  }

  // --- Periyodik Veri Çekimi (Her 5 dakikada bir) ---
  @Interval(300000) // 5 dakika
  private async fetchAndEmitFundingRates() {
    try {
      this.logger.debug('[Binance Futures] Fetching funding rates...');
      const fundingRates = await this.fetchFundingRates();
      if (fundingRates.length > 0) {
        this.fundingRateSubject.next(fundingRates);
        this.logger.debug(`[Binance Futures] Emitted ${fundingRates.length} funding rates`);
      }
    } catch (error) {
      this.logger.error('[Binance Futures] Error fetching funding rates:', error);
    }
  }

  @Interval(300000) // 5 dakika
  private async fetchAndEmitOpenInterest() {
    try {
      this.logger.debug('[Binance Futures] Fetching open interest...');
      const openInterest = await this.fetchOpenInterest();
      if (openInterest.length > 0) {
        this.openInterestSubject.next(openInterest);
        this.logger.debug(`[Binance Futures] Emitted ${openInterest.length} open interest data`);
      }
    } catch (error) {
      this.logger.error('[Binance Futures] Error fetching open interest:', error);
    }
  }
} 