import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as WebSocket from 'ws';
import { Subject } from 'rxjs';
import { ConfigService } from '@nestjs/config';

// HyperLiquid WebSocket message types (based on documentation)
interface WsTrade {
  coin: string;
  side: string;
  px: string;
  sz: string;
  hash: string;
  time: number;
  tid: number;
}

interface HyperLiquidWsMessage {
  channel: string;
  data: any; // Data structure depends on the channel
}

interface SubscriptionResponse {
  method: string;
  subscription: { type: string; coin?: string; user?: string };
}

export interface HyperLiquidMidPriceData {
  symbol: string;
  midPrice: number;
}

interface WsMidPrice {
  coin: string;
  time: number;
  crank_px: string; // Mid-price olarak bu kullanılacak gibi duruyor
}

interface AllMidsData {
  time: number;
  mids: { [coin: string]: string }; // coin -> mid_price string
}

export interface HyperLiquidTradeData {
  symbol: string;
  lastPrice: number;
  timestamp: number;
}

@Injectable()
export class HyperliquidWsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HyperliquidWsService.name);
  private ws: WebSocket | null = null;
  private readonly wsUrl = 'wss://api.hyperliquid.xyz/ws'; // Mainnet
  private pingInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private readonly reconnectDelay = 5000; // 5 seconds

  private hyperliquidTradeStream = new Subject<HyperLiquidTradeData>();
  public hyperliquidTradeStream$ = this.hyperliquidTradeStream.asObservable();

  private hyperliquidMidPriceStream = new Subject<HyperLiquidMidPriceData[]>();
  public hyperliquidMidPriceStream$ = this.hyperliquidMidPriceStream.asObservable();

  private subscribedSymbols: Set<string> = new Set(['BTC', 'ETH']); // Initial test symbols
  private subscribedAllMids = false;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    this.logger.log('Initializing HyperLiquid WebSocket connection...');
    this.connect();
  }

  onModuleDestroy() {
    this.logger.log('Closing HyperLiquid WebSocket connection...');
    this.clearPingInterval();
    this.clearReconnectTimeout();
    if (this.ws) {
      this.ws.removeAllListeners(); // Prevent memory leaks
      this.ws.terminate();
      this.ws = null;
    }
  }

  private connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.logger.warn('WebSocket connection already open.');
      return;
    }

    this.clearPingInterval();
    this.clearReconnectTimeout();
    if (this.ws) {
      this.ws.removeAllListeners(); // Clean up old listeners
    }

    this.logger.log(`Attempting to connect to HyperLiquid WebSocket: ${this.wsUrl}`);
    this.ws = new WebSocket(this.wsUrl);

    this.ws.on('open', () => {
      this.logger.log('HyperLiquid WebSocket connection established.');
      this.reconnectAttempts = 0; // Reset reconnect attempts on successful connection
      this.subscribeToTrades(Array.from(this.subscribedSymbols));
      this.subscribeToAllMids();
      this.startPing();
    });

    this.ws.on('message', (data) => {
      this.handleMessage(data);
    });

    this.ws.on('pong', () => {
      this.logger.verbose('Received pong from HyperLiquid WebSocket.');
      // Optional: Could implement logic to track latency or last pong time
    });

    this.ws.on('error', (error) => {
      this.logger.error(`HyperLiquid WebSocket error: ${error.message}`);
      // Connection will likely close, handled by 'close' event
    });

    this.ws.on('close', (code, reason) => {
      const reasonStr = reason ? reason.toString() : 'No reason provided';
      this.logger.warn(
        `HyperLiquid WebSocket connection closed. Code: ${code}, Reason: ${reasonStr}`,
      );
      this.clearPingInterval();
      this.scheduleReconnect();
    });
  }

  private handleMessage(data: WebSocket.RawData) {
    try {
      const messageStr = data.toString();
      if (messageStr === 'Connection established') {
        this.logger.log('HyperLiquid connection confirmation message received.');
        return;
      }

      const message: HyperLiquidWsMessage = JSON.parse(messageStr);
      // this.logger.verbose(`Received message: ${JSON.stringify(message)}`);

      switch (message.channel) {
        case 'subscriptionResponse':
          this.handleSubscriptionResponse(message.data);
          break;
        case 'trades':
          this.handleTrades(message.data as WsTrade[]);
          break;
        case 'allMids':
          this.handleAllMids(message.data as AllMidsData);
          break;
        case 'pong': // Some exchanges send pong as a message
          this.logger.verbose('Received pong message from HyperLiquid.');
          break;
        case 'error':
          this.logger.error(`HyperLiquid WebSocket error message: ${JSON.stringify(message.data)}`);
          break;
        // Add other channel handlers if needed (e.g., 'l2Book', 'allMids')
        default:
          this.logger.debug(`Unhandled channel type: ${message.channel}`);
      }
    } catch (error) {
      this.logger.error('Failed to parse WebSocket message or handle data.', error);
      this.logger.debug(`Raw message data: ${data.toString()}`);
    }
  }

  private handleSubscriptionResponse(data: SubscriptionResponse) {
    const subType = data.subscription.type;
    const coin = data.subscription.coin;
    const logMsg = `Successfully ${data.method}d ${subType}${coin ? ` (${coin})` : ''}`;
    this.logger.log(logMsg);
    if (subType === 'allMids' && data.method === 'subscribe') {
        this.subscribedAllMids = true;
    } else if (subType === 'allMids' && data.method === 'unsubscribe') {
        this.subscribedAllMids = false;
    }
  }

  private handleTrades(trades: WsTrade[]) {
    if (!Array.isArray(trades)) {
        this.logger.warn('Received non-array data for trades channel:', trades);
        return;
    }

    trades.forEach((trade) => {
      try {
        const lastPrice = parseFloat(trade.px);
        if (isNaN(lastPrice)) {
            this.logger.warn(`Could not parse price for trade: ${JSON.stringify(trade)}`);
            return;
        }
        const tradeData: HyperLiquidTradeData = {
          symbol: trade.coin.toUpperCase(), // Ensure symbol is uppercase
          lastPrice: lastPrice,
          timestamp: trade.time,
        };
        // this.logger.debug(`Processed HyperLiquid Trade: ${JSON.stringify(tradeData)}`);
        this.hyperliquidTradeStream.next(tradeData);
      } catch (error) {
        this.logger.error(`Error processing trade: ${JSON.stringify(trade)}`, error);
      }
    });
  }

  private handleAllMids(data: AllMidsData) {
      if (!data || typeof data.mids !== 'object') {
          this.logger.warn('Received invalid data for allMids channel:', data);
          return;
      }
      const midPriceUpdates: HyperLiquidMidPriceData[] = [];
      const timestamp = data.time || Date.now(); // Zaman damgası yoksa şimdiki zamanı kullan

      for (const coin in data.mids) {
          try {
              const midPrice = parseFloat(data.mids[coin]);
              if (!isNaN(midPrice) && midPrice > 0) {
                  midPriceUpdates.push({
                      symbol: coin.toUpperCase(), // Sembolü büyük harf yap
                      midPrice: midPrice
                  });
              }
          } catch (error) {
              this.logger.warn(`Could not parse midPrice for ${coin}: ${data.mids[coin]}`, error);
          }
      }

      if (midPriceUpdates.length > 0) {
          // this.logger.debug(`Processed ${midPriceUpdates.length} mid-price updates from allMids.`);
          this.hyperliquidMidPriceStream.next(midPriceUpdates);
      }
  }

  public subscribeToTrades(symbols: string[]) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.warn('WebSocket not open, cannot subscribe to trades.');
      // Store symbols to subscribe on reconnect
      symbols.forEach(s => this.subscribedSymbols.add(s.toUpperCase()));
      return;
    }

    symbols.forEach((symbol) => {
      const upperSymbol = symbol.toUpperCase();
      this.logger.log(`Subscribing to HyperLiquid trades for: ${upperSymbol}`);
      const subscriptionMessage = {
        method: 'subscribe',
        subscription: { type: 'trades', coin: upperSymbol },
      };
      this.ws?.send(JSON.stringify(subscriptionMessage));
      this.subscribedSymbols.add(upperSymbol); // Track subscription
    });
  }

  public subscribeToAllMids() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.warn('WebSocket not open, cannot subscribe to allMids.');
      this.subscribedAllMids = true;
      return;
    }
    if (this.subscribedAllMids) {
        this.logger.log('Already subscribed to allMids.');
        return;
    }
    this.logger.log('Subscribing to HyperLiquid allMids channel...');
    const subscriptionMessage = {
      method: 'subscribe',
      subscription: { type: 'allMids' },
    };
    this.ws.send(JSON.stringify(subscriptionMessage));
  }

  public unsubscribeFromTrades(symbols: string[]) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.warn('WebSocket not open, cannot unsubscribe from trades.');
      return;
    }

    symbols.forEach((symbol) => {
      const upperSymbol = symbol.toUpperCase();
      if (!this.subscribedSymbols.has(upperSymbol)) {
        this.logger.warn(`Not subscribed to HyperLiquid trades for ${upperSymbol}, cannot unsubscribe.`);
        return;
      }
      this.logger.log(`Unsubscribing from HyperLiquid trades for: ${upperSymbol}`);
      const unsubscriptionMessage = {
        method: 'unsubscribe',
        subscription: { type: 'trades', coin: upperSymbol },
      };
      this.ws?.send(JSON.stringify(unsubscriptionMessage));
      this.subscribedSymbols.delete(upperSymbol); // Stop tracking
    });
  }

  public unsubscribeFromAllMids() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.subscribedAllMids) {
      this.logger.warn('WebSocket not open or not subscribed to allMids, cannot unsubscribe.');
      return;
    }
    this.logger.log('Unsubscribing from HyperLiquid allMids channel...');
    const unsubscriptionMessage = {
      method: 'unsubscribe',
      subscription: { type: 'allMids' },
    };
    this.ws.send(JSON.stringify(unsubscriptionMessage));
  }

  private startPing() {
    this.clearPingInterval(); // Clear any existing interval
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.logger.verbose('Sending ping to HyperLiquid WebSocket.');
        this.ws.ping((err) => {
          if (err) {
            this.logger.error('Error sending ping:', err);
          }
        });
        // HyperLiquid also expects a JSON ping message based on some docs
        this.ws.send(JSON.stringify({ method: 'ping' }));
      } else {
        this.logger.warn('WebSocket not open, cannot send ping. Clearing interval.');
        this.clearPingInterval();
      }
    }, 50000); // Send ping every 50 seconds
  }

  private clearPingInterval() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error('Max reconnect attempts reached for HyperLiquid WebSocket. Giving up.');
      // Optional: Notify admin or take other action
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, Math.min(this.reconnectAttempts - 1, 4)); // Exponential backoff up to 80s
    this.logger.log(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay / 1000} seconds...`);

    this.clearReconnectTimeout();
    this.reconnectTimeout = setTimeout(() => {
      this.logger.log('Attempting to reconnect HyperLiquid WebSocket...');
      this.connect();
    }, delay);
  }

  private clearReconnectTimeout() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }
} 