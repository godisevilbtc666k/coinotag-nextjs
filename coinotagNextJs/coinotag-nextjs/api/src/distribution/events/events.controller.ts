import { Controller, Sse, MessageEvent, Logger, OnModuleDestroy, Res, Get, Req, Query, Post, Body, Headers, UnauthorizedException, Inject } from '@nestjs/common';
import { Observable, Subject, Subscription, map, filter, startWith, share, catchError, of, interval, BehaviorSubject } from 'rxjs';
import { OnEvent } from '@nestjs/event-emitter';
import { CacheUpdateService } from '../../processing/cache-update/cache-update.service';
import { ProcessedTicker } from '../../processing/cache-update/cache-update.types';
import { PriceAlert } from '../../features/alerts/types/alerts.types';
import { Response, Request } from 'express';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DIRECT_REDIS_CLIENT } from '../../redis/redis.constants';
import { RedisClientType } from 'redis';

@Controller('events')
export class EventsController implements OnModuleDestroy {
  private readonly logger = new Logger(EventsController.name);
  private tickerSubscription: Subscription | null = null;

  // Paylaşılan ve tekrar oynatılabilir bir Observable oluşturuyoruz
  // Yeni bağlanan istemciler son veriyi hemen alır
  private sharedTickerStream$: Observable<ProcessedTicker[]>;
  private breakingNewsSubject = new BehaviorSubject<any[]>([]);
  private breakingNewsStream$ = this.breakingNewsSubject.asObservable();
  private redisSubscription: any = null;

  constructor(
    private readonly cacheUpdateService: CacheUpdateService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(DIRECT_REDIS_CLIENT) private readonly redisClient: RedisClientType
  ) {
    this.logger.log('Initializing EventsController and shared ticker stream...');

    this.sharedTickerStream$ = this.cacheUpdateService.combinedTickerStream$.pipe(
      // Önce sadece USDT paritelerini filtrele
      map((tickers: any[]) => { // Gelen tip any[] olabilir (flattened)
        // === LOG 1: Filtrelemeden ÖNCE ===
        // this.logger.debug(`[SSE Stream] Processing ${tickers.length} tickers from cache service.`); // KALDIRILDI

        // --- DEBUG LOG: BTC ve HYPE verisini kontrol et ---
        const btcTicker = tickers.find(t => t.symbol === 'BTC');
        const hypeTicker = tickers.find(t => t.symbol === 'HYPE');
        if (btcTicker) {
            // this.logger.debug(`[SSE SEND BTC] Data: ${JSON.stringify(btcTicker)}`);
        }
        if (hypeTicker) {
             // this.logger.debug(`[SSE SEND HYPE] Data: ${JSON.stringify(hypeTicker)}`);
        }
        // --- DEBUG LOG SONU ---

        return tickers;
      }),
      // Error handling ekliyoruz
      catchError((error) => {
        this.logger.error('Error in ticker stream processing:', error);
        return of([]);
      }),
      // startWith içindeki ilk veriyi de filtreleyelim - FLATTENED VERSİYON KULLAN
      startWith((() => {
        const initialData = this.cacheUpdateService.getAllFlattenedTickers();
        // this.logger.debug(`Initial SSE Data Length: Ticker Count: ${initialData.length}`);
        return initialData;
      })()),
      share() // Birden fazla aboneye aynı stream'i paylaşır
    );

    // Stream'in aktif kalmasını sağlamak için boş bir subscribe yapabiliriz
    // Veya ilk istemci bağlandığında subscribe olmasını bekleyebiliriz.
    // Şimdilik aktif tutalım:
    this.tickerSubscription = this.sharedTickerStream$.subscribe({
        next: () => { /* Veri başarıyla map edildi */ },
        error: (err) => this.logger.error('Error in shared ticker stream:', err),
        complete: () => this.logger.warn('Shared ticker stream completed unexpectedly.')
    });
    this.logger.log('Shared ticker stream is active.');

    // BUSINESS: Secure Redis news channel subscription
    this.initializeSecureNewsChannel();
  }

  @Get('ticker')
  async sseTicker(@Res() res: Response): Promise<void> {
    this.logger.log('Client connected to SSE ticker endpoint.');
    
    const origin = res.req?.headers?.origin;
    this.logger.debug(`SSE Request origin: ${origin}`);
    
    // Herhangi bir localhost origin'e izin ver
    const corsOrigin = origin && origin.includes('localhost') ? origin : 'http://localhost:3000';
    
    // SSE Headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Accept, Cache-Control, Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    // İlk veriyi gönder
    const initialData = this.cacheUpdateService.getAllFlattenedTickers();
    this.sendSSEMessage(res, 'message', JSON.stringify(initialData), 'initial');
    
    // Stream'e subscribe ol ve yeni verileri gönder
    const subscription = this.sharedTickerStream$.subscribe({
      next: (tickers) => {
        // this.logger.debug(`Sending ${tickers.length} tickers to SSE client`);
        this.sendSSEMessage(res, 'message', JSON.stringify(tickers), Date.now().toString());
      },
      error: (error) => {
        this.logger.error('SSE stream error:', error);
        this.sendSSEMessage(res, 'error', JSON.stringify({ error: 'Stream error' }));
        res.end();
      }
    });
    
    // Client disconnect handling
    res.on('close', () => {
      this.logger.log('SSE client disconnected');
      subscription.unsubscribe();
    });
    
    res.on('error', (error) => {
      this.logger.error('SSE response error:', error);
      subscription.unsubscribe();
    });
  }

  private sendSSEMessage(res: Response, event: string, data: string, id?: string): void {
    if (id) {
      res.write(`id: ${id}\n`);
    }
    res.write(`event: ${event}\n`);
    res.write(`data: ${data}\n\n`);
  }

  // Alert tetikleme event handler'ı - OPTIMIZE EDİLDİ
  @OnEvent('alert.triggered')
  handleAlertTriggeredEvent(payload: { alert: PriceAlert, triggerValue: number, triggerTime: number, marketData: any }) {
    const { alert, triggerValue, triggerTime, marketData } = payload;
    
    // PERFORMANS: Minimal logging
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log(`🚨 Alert triggered: ${alert.symbol} ${alert.condition} $${alert.targetPrice} for user ${alert.userId}`);
    }

    // TODO: User-specific SSE implementation
    // Bu geliştirme aşamasında şimdilik event'i log'layıp email ile notification gönderiyoruz
    // Gelecekte user-specific WebSocket connection management eklenecek

    const alertNotification = {
      type: 'alert_triggered',
      alertId: alert.id,
      symbol: alert.symbol,
      targetPrice: alert.targetPrice,
      condition: alert.condition,
      triggeredPrice: triggerValue,
      triggeredAt: triggerTime,
      marketType: alert.marketType || 'spot',
      userId: alert.userId
    };

    // INSTANT: Browser notification için frontend'e gönderim (gelecek için hazır)
    // this.sendToUserConnection(alert.userId, alertNotification);
    
    // PERFORMANS: Production'da detaylı log yok
    if (process.env.NODE_ENV !== 'production') {
      this.logger.debug(`Alert notification prepared for user ${alert.userId}:`, alertNotification);
    }
  }

  // Helper function (if needed later for broadcasting, not user-specific)
  // private sendToAllClients(message: MessageEvent) {
  //   // This requires managing a list of connected client response objects or using a Subject
  //   // For simplicity, assuming sharedTickerStream$ pushes to all if modified, which isn't ideal for this case.
  // }

  onModuleDestroy() {
    this.logger.log('Cleaning up EventsController subscription.');
    this.tickerSubscription?.unsubscribe();
    
    // Clean up Redis subscription
    if (this.redisSubscription) {
      this.redisSubscription.unsubscribe();
      this.redisSubscription.quit();
    }
  }

  @Sse('ticker')
  ticker(@Req() req: Request, @Res() res: Response): Observable<MessageEvent> {
    // CORS headers
    const allowedOrigins = [
      'http://localhost:3000',
      'https://coinotag.vercel.app',
      'https://coinotag.com',
      'https://www.coinotag.com'
    ];
    
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    // Mevcut shared stream'i kullan
    return this.sharedTickerStream$.pipe(
      map((tickers) => ({
        data: JSON.stringify(tickers),
        type: 'ticker',
      } as MessageEvent))
    );
  }

  // YENİ: Breaking News SSE Endpoint - GERÇEK VERİ
  @Sse('breaking-news')
  breakingNews(@Req() req: Request, @Res() res: Response): Observable<MessageEvent> {
    // CORS headers
    const allowedOrigins = [
      'http://localhost:3000',
      'https://coinotag.vercel.app',
      'https://coinotag.com',
      'https://www.coinotag.com'
    ];
    
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    this.logger.log('🚨 Business Breaking News SSE connection established');
    
    // Gerçek breaking news stream - cache'den başlar, yeni haberler real-time gelir
    return this.breakingNewsStream$.pipe(
      startWith(this.getLatestBreakingNews()), // İlk bağlantıda mevcut haberleri gönder
      map((news) => ({
        data: JSON.stringify(news),
        type: 'breaking-news',
      } as MessageEvent)),
      share()
    );
  }

  // BUSINESS: Secure Redis News Channel
  private async initializeSecureNewsChannel() {
    try {
      this.logger.log('🔒 Initializing secure business news channel...');
      
      const subscriber = this.redisClient.duplicate();
      await subscriber.connect();
      await subscriber.subscribe('coinotag:business:breaking-news', (message, channel) => {
        try {
          const newsData = JSON.parse(message);
          this.logger.log('📰 Secure business news received via Redis');
          
          const formattedNews = this.formatIncomingNews(newsData);
          this.addToBreakingNewsCache(formattedNews);
          
          // Push to all SSE clients
          const latestNews = this.getLatestBreakingNews();
          this.breakingNewsSubject.next(latestNews);
          
        } catch (error) {
          this.logger.error('❌ Error processing secure news:', error);
        }
      });
      
      this.redisSubscription = subscriber;
      this.logger.log('✅ Secure business news channel active');
      
    } catch (error) {
      this.logger.error('❌ Failed to initialize secure news channel:', error);
    }
  }

  // Breaking news cache yönetimi
  private breakingNewsCache: any[] = [];
  private readonly MAX_CACHE_SIZE = 50;

  private formatIncomingNews(newsData: any): any[] {
    // Python bot'tan gelen veriyi formatla
    if (Array.isArray(newsData)) {
      return newsData.map(item => ({
        id: item.id || `news-${Date.now()}-${Math.random()}`,
        title: item.title || item.headline,
        content: item.content || item.description || '',
        timestamp: item.timestamp || new Date().toISOString(),
        category: item.category || 'breaking',
        priority: item.priority || 'medium',
        relatedSymbols: item.symbols || item.relatedSymbols || [],
        source: item.source || 'Internal',
        slug: item.slug || '',
      }));
    }
    
    // Tek haber objesi ise
    return [{
      id: newsData.id || `news-${Date.now()}-${Math.random()}`,
      title: newsData.title || newsData.headline,
      content: newsData.content || newsData.description || '',
      timestamp: newsData.timestamp || new Date().toISOString(),
      category: newsData.category || 'breaking',
      priority: newsData.priority || 'medium',
      relatedSymbols: newsData.symbols || newsData.relatedSymbols || [],
      source: newsData.source || 'Internal',
      slug: newsData.slug || '',
    }];
  }

  private addToBreakingNewsCache(news: any[]): void {
    // Yeni haberleri cache'in başına ekle
    this.breakingNewsCache.unshift(...news);
    
    // Cache boyutunu kontrol et
    if (this.breakingNewsCache.length > this.MAX_CACHE_SIZE) {
      this.breakingNewsCache = this.breakingNewsCache.slice(0, this.MAX_CACHE_SIZE);
    }
    
    this.logger.debug(`📰 Breaking news cache updated. Total: ${this.breakingNewsCache.length}`);
  }

  private getLatestBreakingNews(): any[] {
    return this.breakingNewsCache.slice(0, 20); // En son 20 haber
  }

  // REST endpoint for breaking news (backup/polling)
  @Get('breaking-news')
  async getBreakingNews(@Query('limit') limit?: string) {
    const requestedLimit = parseInt(limit) || 10;
    const latestNews = this.getLatestBreakingNews().slice(0, requestedLimit);
    
    return {
      breakingNews: latestNews,
      count: latestNews.length,
      status: 'success'
    };
  }
} 