import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as WebSocket from 'ws';
import { Subject } from 'rxjs';
import { BinanceRawTicker } from './binance-spot.types';
import { WsConnectionStatus } from '../../../common/types/connection-status.types';

@Injectable()
export class BinanceSpotWsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BinanceSpotWsService.name);
  private ws: WebSocket.WebSocket | null = null;
  private connectionStatus: WsConnectionStatus = 'disconnected';
  private connectionAttemptInterval: NodeJS.Timeout | null = null;
  private readonly wsUrl = 'wss://stream.binance.com:9443/ws/!ticker@arr'; // Veya config'den alınabilir

  // Gelen ham ticker verilerini yayınlamak için Subject
  private rawTickerSubject = new Subject<BinanceRawTicker[]>();
  public rawTickerStream$ = this.rawTickerSubject.asObservable();

  // Add Subject for connection status
  private connectionStatusSubject = new Subject<WsConnectionStatus>();
  public connectionStatusStream$ = this.connectionStatusSubject.asObservable();

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    this.logger.log('Initializing Binance Spot WebSocket connection...');
    this.connect();
  }

  onModuleDestroy() {
    this.logger.log('Closing Binance Spot WebSocket connection...');
    this.clearConnectionAttemptInterval();
    this.closeConnection();
  }

  private connect() {
    if (this.ws || this.connectionStatus === 'connecting' || this.connectionStatus === 'connected') {
      this.logger.warn(`WebSocket connection attempt skipped. Status: ${this.connectionStatus}`);
      return;
    }

    this.connectionStatus = 'connecting';
    this.connectionStatusSubject.next(this.connectionStatus);
    this.logger.log(`Attempting to connect to ${this.wsUrl} (Status: ${this.connectionStatus})`);

    this.ws = new WebSocket(this.wsUrl);

    this.ws.on('open', () => {
      this.connectionStatus = 'connected';
      this.connectionStatusSubject.next(this.connectionStatus);
      this.logger.log(`Binance Spot WebSocket connection established. (Status: ${this.connectionStatus})`);
      this.clearConnectionAttemptInterval();
    });

    this.ws.on('message', (data: WebSocket.RawData) => {
      try {
        const message = JSON.parse(data.toString());
        if (Array.isArray(message) && message.length > 0 && message[0].e === '24hrTicker') {
           this.rawTickerSubject.next(message as BinanceRawTicker[]);
        } else {
          // Beklenmeyen formatta mesaj gelirse logla
          // this.logger.debug('Received non-ticker message or empty array:', message);
        }
      } catch (error) {
        this.logger.error('Failed to parse WebSocket message:', error);
      }
    });

    this.ws.on('error', (error: Error) => {
      const previousStatus = this.connectionStatus;
      this.connectionStatus = 'error';
      this.connectionStatusSubject.next(this.connectionStatus);
      this.logger.error(`Binance Spot WebSocket error (Previous Status: ${previousStatus}). Error: ${error.message}`);
      this.handleDisconnect();
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      const wasIntentional = this.connectionStatus === 'disconnected';
      if (!wasIntentional) {
        this.logger.warn(`Binance Spot WebSocket closed unexpectedly. Code: ${code}, Reason: ${reason.toString()}. Status: ${this.connectionStatus}. Attempting to reconnect...`);
        this.handleDisconnect();
      } else {
          this.logger.log(`Binance Spot WebSocket connection closed intentionally. (Status: ${this.connectionStatus})`);
      }
      this.ws = null;
    });
  }

  private handleDisconnect() {
    this.closeConnection(false);
    this.scheduleReconnection();
  }

  private scheduleReconnection() {
    if (this.connectionAttemptInterval) return;

    const reconnectDelay = 5000;
    this.logger.log(`Scheduling reconnection attempt in ${reconnectDelay / 1000} seconds... (Current Status: ${this.connectionStatus})`);

    this.connectionAttemptInterval = setTimeout(() => {
      this.connectionAttemptInterval = null;
      if (this.connectionStatus === 'disconnected' || this.connectionStatus === 'error') {
         this.connect();
      } else {
          this.logger.log(`Skipping scheduled reconnection as status is already ${this.connectionStatus}`);
      }
    }, reconnectDelay);
  }

  private clearConnectionAttemptInterval() {
    if (this.connectionAttemptInterval) {
      clearTimeout(this.connectionAttemptInterval);
      this.connectionAttemptInterval = null;
      this.logger.log('Cleared scheduled reconnection attempt.');
    }
  }

  private closeConnection(log = true) {
    const previousStatus = this.connectionStatus;
    if (this.ws) {
      if (log) this.logger.log(`Closing existing WebSocket connection (Current Status: ${previousStatus}).`);

      this.ws.removeAllListeners();
      this.ws.terminate();
      this.ws = null;
    }
    if (previousStatus !== 'disconnected') {
        this.connectionStatus = 'disconnected';
        this.connectionStatusSubject.next(this.connectionStatus);
        if (log) this.logger.log(`Connection status set to: ${this.connectionStatus}`);
    }
  }

  public getCurrentStatus(): WsConnectionStatus {
    return this.connectionStatus;
  }
} 