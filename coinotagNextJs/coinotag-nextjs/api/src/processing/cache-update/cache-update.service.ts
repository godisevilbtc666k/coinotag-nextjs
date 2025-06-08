import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { RedisClientType } from 'redis';
import { Subject, Subscription, bufferTime, filter, merge, throttleTime } from 'rxjs';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { BinanceSpotWsService } from '../../data-sources/binance/spot/binance-spot-ws.service';
import { BinanceRawTicker } from '../../data-sources/binance/spot/binance-spot.types';
import { DIRECT_REDIS_CLIENT } from '../../redis/redis.constants';
import { ProcessedTicker, BybitSpotData, BybitFuturesData } from './cache-update.types';
import { BinanceDataSource } from '../../data-sources/binance/common/binance.types';
import { BinanceFuturesService } from '../../data-sources/binance/futures/binance-futures.service';
import {
  BinanceFuturesMarkPrice,
  BinanceFuturesFundingRate,
  BinanceFuturesOpenInterest,
  BinanceFuturesTicker,
} from '../../data-sources/binance/futures/binance-futures.types';
import { BybitSpotWsService } from '../../data-sources/bybit/spot/bybit-spot-ws.service';
import { BybitFuturesWsService } from '../../data-sources/bybit/futures/bybit-futures-ws.service';
import { BybitFundingData, BybitSpotTickerData, BybitFuturesTickerData } from '../../data-sources/bybit/bybit.types';
import { HyperLiquidService } from '../../data-sources/hyperliquid/hyperliquid.service';
import { HyperLiquidFundingData } from '../../data-sources/hyperliquid/hyperliquid.types';
import { CoinGeckoService } from '../../data-sources/coingecko/coingecko.service';
import { CoinGeckoMarketData } from '../../data-sources/coingecko/coingecko.types';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { HyperliquidWsService, HyperLiquidTradeData, HyperLiquidMidPriceData } from '../../data-sources/hyperliquid/hyperliquid-ws.service';

// --- YENİ: KATEGORİ TANIMLARI --- 
interface CoinCategory {
  id: string;
  name: string;
  keywords: string[];
}

const cryptoCategories: CoinCategory[] = [
  { 
    id: 'layer-1', 
    name: 'Layer 1', 
    keywords: [
      'BTC', 'ETH', 'SOL', 'ADA', 'AVAX', 'DOT', 'NEAR', 'ATOM', 'FTM', 'ALGO', 
      'XTZ', 'EOS', 'TRX', 'KAS', 'INJ', 'SUI', 'APT', 'BNB', 'XRP', 'LTC', 
      'XLM', 'ICP', 'HBAR', 'CRO', 'FLR', 'SEI', 'FLOW', 'KAVA', 'EGLD', 'XEC', 
      'TON', 'ASTR', 'ONE', 'HIVE', 'ZIL', 'KLAY', 'IOTA', 'WAX', 'QNT', 'NEO',
      'BCH', 'ETC', 'BSV', 'BTG', 'DASH', 'ZEC', 'XMR', 'KSM', 'CELO', 'ONT'
    ]
  },
  { 
    id: 'layer-2', 
    name: 'Layer 2', 
    keywords: [
      'MATIC', 'POL', 'ARB', 'OP', 'IMX', 'LRC', 'METIS', 'SKL', 'MANTA', 'STRK', 
      'ZRX', 'CARTESI', 'BOBA', 'SYS', 'HERMES', 'OMG', 'BAT', 'BNT', 'BICO', 'SYS'
    ]
  },
  { 
    id: 'defi', 
    name: 'DeFi', 
    keywords: [
      'UNI', 'AAVE', 'LDO', 'MKR', 'SNX', 'COMP', 'CRV', 'SUSHI', 'YFI', '1INCH', 
      'CAKE', 'RUNE', 'DYDX', 'GMX', 'PENDLE', 'JOE', 'RDNT', 'CVX', 'BAL', 'ZRX', 
      'KNC', 'BNT', 'BAND', 'RSR', 'JST', 'RAY', 'JTO', 'SXP', 'PERP', 'FLM', 
      'ANC', 'ALPHA', 'BADGER', 'DF', 'FARM', 'FORTH', 'MDX', 'RIF', 'TORN', 'XVS',
      'TRU', 'BEL', 'DODO', 'FIS', 'GHST', 'IDEX', 'LINA', 'MIR', 'OXT', 'PNT'
    ]
  },
  { 
    id: 'meme-coin', 
    name: 'Meme Coin', 
    keywords: [
      'DOGE', 'SHIB', 'PEPE', 'WIF', 'FLOKI', 'BONK', 'MEME', 'BOME', 'NEIRO', 
      'TURBO', 'MOG', 'BABYDOGE', 'SNEK', 'GROK', 'MEW', 'CHZ', 'KISHU', 'SAMO', 
      'SLERF', 'SUN', 'TRUMP', 'XAI', 'ZBC', 'ELON', 'PIT', 'SAMO', 'VOLT', 'WEN'
    ]
  },
  { 
    id: 'ai', 
    name: 'Yapay Zeka (AI)', 
    keywords: [
      'TAO', 'RNDR', 'FET', 'AGIX', 'OCEAN', 'GRT', 'AKT', 'NMR', 'RLC', 'WLD', 
      'ARKM', 'AIOZ', 'RSS3', 'IQ', 'ID', 'PHB', 'CTSI', 'DIA', 'ERN', 'MLN'
    ]
  },
  { 
    id: 'gamefi', 
    name: 'GameFi / Metaverse', 
    keywords: [
      'AXS', 'SAND', 'MANA', 'GALA', 'APE', 'ENJ', 'ILV', 'PYR', 'ALICE', 'RON', 
      'MAGIC', 'PIXEL', 'VOXEL', 'YGG', 'NAKA', 'TLM', 'DAR', 'HIGH', 'GMT', 
      'CHR', 'WEMIX', 'SUPER', 'MINA', 'HOOK', 'MBOX', 'RACA', 'TOKEN', 'UOS',
      'WILD', 'SIDUS', 'STARL', 'VRA', 'AURY', 'GF', 'GHST', 'GODS', 'MC', 'MPL'
    ]
  },
  { 
    id: 'infrastructure', 
    name: 'Altyapı', 
    keywords: [
      'LINK', 'FIL', 'ICP', 'AR', 'HNT', 'THETA', 'STX', 'ANKR', 'BAND', 'API3', 
      'GLM', 'CQT', 'NKN', 'POKT', 'ORAI', 'DIA', 'TRAC', 'CTSI', 'PROM', 'XYO',
      'AERGO', 'ARDR', 'BLZ', 'CVC', 'DGB', 'ELF', 'ERN', 'FIO', 'FLUX', 'HOT'
    ]
  },
  { 
    id: 'smart-contract', 
    name: 'Akıllı Kontrat', 
    keywords: [
      'ETH', 'ADA', 'SOL', 'DOT', 'AVAX', 'TRX', 'EOS', 'XTZ', 'NEAR', 'ALGO', 
      'VET', 'ICX', 'CELO', 'KLAY', 'WAVES', 'ZIL', 'IOTA', 'NEO', 'ONT', 'QTUM',
      'AION', 'ANKR', 'ANT', 'ARDR', 'ARK', 'AVA', 'BAND', 'BAT', 'BTS', 'CTK'
    ]
  },
  { 
    id: 'privacy', 
    name: 'Gizlilik', 
    keywords: [
      'XMR', 'ZEC', 'DASH', 'ROSE', 'SCRT', 'KEEP', 'BEAM', 'DCR', 'ZEN', 'PIVX',
      'FIRO', 'GRIN', 'MWC', 'NAV', 'PART', 'XHV', 'XVG', 'ZANO', 'ZEPH', 'PIRATE'
    ]
  },
  { 
    id: 'storage', 
    name: 'Depolama', 
    keywords: [
      'FIL', 'AR', 'STORJ', 'BLZ', 'SIA', 'MAID', 'CRU', 'BZZ', 'NYM', 'OORT',
      'CRUST', 'DIA', 'DX', 'FIO', 'FLUX', 'HOT', 'LAMB', 'MDT', 'NBS', 'SC'
    ]
  }
];

// Kategori bulma fonksiyonu (API içine kopyalandı)
function getCategoriesForSymbol(symbol: string): CoinCategory[] {
  const upperSymbol = symbol.toUpperCase();
  return cryptoCategories.filter(category => 
    category.keywords.includes(upperSymbol)
  );
}
// --- KATEGORİ TANIMLARI SONU ---

// YENİ: Bekleyen OI güncellemeleri için tip tanımı
interface PendingOiUpdate {
    oiBaseAsset: number;
    timestamp: number; // Ne zaman geldiğini bilmek için (opsiyonel)
}

@Injectable()
export class CacheUpdateService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheUpdateService.name);
  private readonly dataSource: BinanceDataSource = 'binance';

  private latestTickerCache = new Map<string, ProcessedTicker>();
  // YENİ: Fiyatı olmayan OI güncellemelerini bekletmek için Map
  private pendingBinanceOiUpdates = new Map<string, PendingOiUpdate>();
  private readonly PENDING_OI_TIMEOUT_MS = 10000; // 10 seconds timeout for pending OI

  private combinedTickerSubject = new Subject<ProcessedTicker[]>();
  public combinedTickerStream$ = this.combinedTickerSubject.asObservable();

  // --- DEĞİŞİKLİK: Throttling için yeni subject ---
  private updateTriggerSubject = new Subject<void>();
  private throttledUpdateSubscription: Subscription | null = null; 

  private subscriptions: Subscription[] = [];
  private redisUpdateSubscription: Subscription | null = null;

  private redisUpdateQueue = new Subject<ProcessedTicker>();

  constructor(
    private readonly binanceSpotWsService: BinanceSpotWsService,
    private readonly binanceFuturesService: BinanceFuturesService,
    private readonly bybitSpotService: BybitSpotWsService,
    private readonly bybitFuturesService: BybitFuturesWsService,
    private readonly hyperLiquidService: HyperLiquidService,
    private readonly coinGeckoService: CoinGeckoService,
    @Inject(DIRECT_REDIS_CLIENT) private readonly redisClient: Redis,
    private eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
    private readonly hyperliquidWsService: HyperliquidWsService,
  ) {
    this.logger.log('CacheUpdateService Initialized');
    this.startPendingOiCleanup();
    // --- DEĞİŞİKLİK: Throttled update'i başlat ---
    this.setupThrottledUpdate(); 
  }

  async onModuleInit() {
    this.logger.log('Initializing CacheUpdateService...');
    await this.loadInitialCacheFromRedis();
    this.subscribeToDataStreams();
    this.setupRedisBatchUpdate();
    // Trigger initial CoinGecko fetch
    this.logger.log('Triggering initial fast CoinGecko update...');
    this.handleFastCoinGeckoUpdate().catch(err => {
        this.logger.error('Error during initial fast CoinGecko update:', err);
    });
  }

  // --- DEĞİŞİKLİK: Throttling update subscription'ını kur ---
  private setupThrottledUpdate() {
    const throttleDuration = 750; // ms - SSE güncelleme sıklığı
    this.logger.log(`Setting up throttled update with ${throttleDuration}ms interval.`);
    this.throttledUpdateSubscription = this.updateTriggerSubject.pipe(
      throttleTime(throttleDuration, undefined, { leading: true, trailing: true }) 
    ).subscribe(() => {
      // DEBUG -> VERBOSE
      this.logger.verbose('Throttled update triggered.');
      this.prepareAndPublishUpdate(); 
    });
  }

  private subscribeToDataStreams() {
    this.subscriptions.push(
      this.binanceSpotWsService.rawTickerStream$.subscribe({
        next: (tickers) => this.processIncomingSpotTickers(tickers),
        error: (err) => this.logger.error('Error in Binance Spot WS stream:', err),
      })
    );

    this.subscriptions.push(
      this.binanceFuturesService.futuresTickerStream$.subscribe({
        next: (tickers) => this.processIncomingFuturesTickers(tickers),
        error: (err) => this.logger.error('Error in Binance Futures Ticker stream:', err),
      })
    );

    this.subscriptions.push(
      this.binanceFuturesService.fundingRateStream$.subscribe({
        next: (fundingRates) => {
            this.processIncomingBinanceFundingRates(fundingRates);
        },
        error: (err) => this.logger.error('Error in Binance Futures Funding Rate stream:', err),
      })
    );

    this.subscriptions.push(
      this.binanceFuturesService.openInterestStream$.subscribe({
        next: (openInterests) => {
            this.processIncomingBinanceOpenInterest(openInterests);
        },
        error: (err) => this.logger.error('Error in Binance Futures Open Interest stream:', err),
      })
    );

    this.subscriptions.push(
      this.bybitFuturesService.fundingDataStream$.subscribe({
          next: (bybitData) => this.processIncomingBybitData(bybitData),
          error: (err) => this.logger.error('Error in Bybit FR/OI stream:', err),
      })
    );

    this.subscriptions.push(
      this.hyperLiquidService.fundingDataStream$.subscribe({
          next: (hyperliquidData) => this.processIncomingHyperLiquidData(hyperliquidData),
          error: (err) => this.logger.error('Error in HyperLiquid FR/OI stream:', err),
      })
    );

    this.subscriptions.push(
      this.bybitSpotService.spotTickerStream$.subscribe({
        next: (tickers) => this.processIncomingBybitSpotTickers(tickers),
        error: (err) => this.logger.error('Error in Bybit Spot Ticker stream:', err),
      })
    );

    this.subscriptions.push(
      this.bybitFuturesService.futuresTickerStream$.subscribe({
        next: (tickers) => this.processIncomingBybitFuturesTickers(tickers),
        error: (err) => this.logger.error('Error in Bybit Futures Ticker stream:', err),
      })
    );

    this.subscriptions.push(
      this.hyperliquidWsService.hyperliquidTradeStream$.subscribe({
          next: trade => this.processIncomingHyperLiquidTrade(trade),
          error: (err) => this.logger.error('Error in HyperLiquid Trade Stream', err)
      })
    );

    this.subscriptions.push(
      this.hyperliquidWsService.hyperliquidMidPriceStream$.subscribe({
          next: midPrices => this.processIncomingHyperLiquidMidPrices(midPrices),
          error: (err) => this.logger.error('Error in HyperLiquid Mid Price Stream', err)
      })
    );
  }

  private setupRedisBatchUpdate() {
    const bufferTimeMs = 1000;
    const maxBufferSize = 500;
    this.redisUpdateSubscription = this.redisUpdateQueue.pipe(
        bufferTime(bufferTimeMs, undefined, maxBufferSize),
        filter(tickers => tickers.length > 0)
    ).subscribe(async (tickersToUpdate) => {
        if (tickersToUpdate.length > 0) {
            const uniqueTickers = Array.from(new Map(tickersToUpdate.map(t => [`processed:${t.symbol}`, t])).values());
            await this.updateRedisCache(uniqueTickers);
        }
    });
  }

  public cleanSymbol(rawSymbol: string): string | null {
    if (!rawSymbol || typeof rawSymbol !== 'string') return null;

    // SYRUP gibi özel durumları en başta ele al
    if (rawSymbol.toUpperCase().startsWith('SYRUP')) {
      const syrupMatch = rawSymbol.toUpperCase().match(/^(SYRUP)(USDT|BUSD|USDC|TUSD)?$/);
      if (syrupMatch && syrupMatch[1] === 'SYRUP') {
        return 'SYRUP'; // Sadece SYRUP döndür, suffix temizlenmiş olacak
      }
    }

    // 1. Suffixleri temizle (USDT başta olmak üzere)
    const validEndings = ['USDT', 'BUSD', 'USDC', 'TUSD'];
    let baseSymbol = rawSymbol.toUpperCase();
    let suffixFound = false;
    for (const ending of validEndings) {
      if (baseSymbol.endsWith(ending)) {
        baseSymbol = baseSymbol.substring(0, baseSymbol.length - ending.length);
        suffixFound = true;
        break;
      }
    }
    
    // Sadece USDT (ve diğerleri) ile bitenleri işleyelim
    if (!suffixFound) {
        // this.logger.warn(`Symbol ${rawSymbol} does not end with a valid quote asset. Skipping.`);
        return null;
    }

    // 2. Potansiyel prefix'leri temizle (1000, 100, vb.)
    baseSymbol = baseSymbol.replace(/^(10000|1000|100)/, '');

    // 3. Diğer temizlikler (Kaldıraç, PERP vs.)
    baseSymbol = baseSymbol
      .replace(/(UP|DOWN|BULL|BEAR|LONG|SHORT)[0-9]*X?/g, '')
      .replace(/([1-9][0-9]*)X$/g, '')
      .replace(/PERP$/i, '');

    // 4. Stablecoin ve Türev kontrolü (STETH eklendi)
    const stablecoinsAndDerivatives = ['BUSD', 'USDC', 'TUSD', 'FDUSD', 'DAI', 'USDP', 'USTC', 'STETH'];
    if (stablecoinsAndDerivatives.includes(baseSymbol)) {
        // this.logger.debug(`Symbol ${baseSymbol} is a stablecoin or derivative. Skipping.`);
        return null;
    }

    // 5. Geçerlilik kontrolü ve son düzeltmeler
    if (!/^[A-Z0-9]+$/.test(baseSymbol) || baseSymbol.length === 0) {
        // this.logger.warn(`Cleaned symbol ${baseSymbol} is invalid or empty. Original: ${rawSymbol}`);
        return null;
    }

    // Özel durumlar (varsa)
    if (baseSymbol === 'WBT') baseSymbol = 'WBTC';

    return baseSymbol;
  }

  private normalizeSymbol(symbol: string): string {
    const symbolMap: Record<string, string> = { "WBTC": "BTC", "WETH": "ETH" };
    return symbolMap[symbol] || symbol;
  }

  private createDefaultProcessedTicker(symbol: string): ProcessedTicker {
    const now = Date.now();
    return {
        symbol: symbol,
        normalizedSymbol: this.normalizeSymbol(symbol),
        lastUpdatedOverall: now,
        spot: {
            binance: {}
        },
        futures: {
            binance: {},
            bybit: {},
            hyperliquid: {}
        },
        coingecko: {},
        lastUpdated: now,
        source: 'combined',
    };
  }

  private processIncomingSpotTickers(rawTickers: BinanceRawTicker[]) {
    // PERFORMANS: Batch processing
    if (!rawTickers || rawTickers.length === 0) return;

    let updateCount = 0;
    const batchStart = Date.now();

    for (const raw of rawTickers) {
      try {
        const symbol = this.cleanSymbol(raw.s);
        if (!symbol) continue;

        const existingTicker = this.getOrCreateTicker(symbol);
        const lastPrice = parseFloat(raw.c);
        const volume = parseFloat(raw.v) * lastPrice;

        // PERFORMANS: Sadece önemli değişiklik varsa güncelle
        if (existingTicker.spot?.binance?.lastPrice && 
            Math.abs(lastPrice - existingTicker.spot.binance.lastPrice) < 0.000001) {
          continue; // Micro değişiklikleri ignore et
        }

        // Memory cache'i güncelle
        existingTicker.spot = existingTicker.spot || { binance: {} };
        existingTicker.spot.binance = {
          ...existingTicker.spot.binance,
          lastPrice,
          priceChangePercent: parseFloat(raw.P),
          volume: volume,
          high: parseFloat(raw.h),
          low: parseFloat(raw.l),
          lastUpdated: Date.now(),
        };

        // YENİ: Orijinal spot sembolünü ekle (futures'a benzer şekilde)
        existingTicker.binanceOriginalSpotSymbol = raw.s;
        existingTicker.lastUpdatedOverall = Date.now();
        
        // Cache'i güncelle
        this.latestTickerCache.set(symbol, existingTicker);
        
        // Redis'e queue'la
        this.queueForRedisUpdate(existingTicker);
        updateCount++;

      } catch (error) {
        // PERFORMANS: Silent fail
        if (process.env.NODE_ENV !== 'production') {
          this.logger.warn(`Spot ticker processing error:`, error);
        }
      }
    }

    // PERFORMANS: Tek trigger ile throttled update
    if (updateCount > 0) {
      this.updateTriggerSubject.next();
      
      // PERFORMANS: Batch processing log
      const duration = Date.now() - batchStart;
      if (process.env.NODE_ENV !== 'production' && duration > 50) {
        this.logger.warn(`Spot batch (${updateCount}/${rawTickers.length}) took ${duration}ms`);
      }
    }
  }

  private processIncomingFuturesTickers(futuresTickers: BinanceFuturesTicker[]) {
    const updatedSymbols = new Set<string>();
    const now = Date.now();
    let needsUpdateEmit = false;

    for (const rawTicker of futuresTickers) {
      const symbol = this.cleanSymbol(rawTicker.s);
      if (!symbol) continue;

      const parsedPrice = parseFloat(rawTicker.c);
      if (isNaN(parsedPrice) || parsedPrice <= 0) continue;

      let ticker = this.getOrCreateTicker(symbol); // Bu zaten nested structure sağlıyor
      
      // Ekstra güvenlik kontrolü
      if (!ticker.futures) ticker.futures = {};
      if (!ticker.futures.binance) ticker.futures.binance = {};
      
      const binanceFuturesData = {
        ...ticker.futures.binance,
        lastPrice: parsedPrice,
        priceChangePercent: parseFloat(rawTicker.P),
        volume: parseFloat(rawTicker.q),
        high: parseFloat(rawTicker.h),
        low: parseFloat(rawTicker.l),
        lastUpdatedTicker: rawTicker.E || now,
      };

      ticker = {
        ...ticker,
        futures: {
          ...ticker.futures,
          binance: binanceFuturesData,
        },
        // YENİ: Orijinal futures sembolünü ekle
        binanceOriginalFuturesSymbol: rawTicker.s,
        lastUpdatedOverall: now,
      };
      
      this.latestTickerCache.set(symbol, ticker);
      this.queueForRedisUpdate(ticker);
      updatedSymbols.add(symbol);
      needsUpdateEmit = true;
    }
    // --- DEĞİŞİKLİK: Doğrudan publish yerine trigger ---
    if (needsUpdateEmit) this.updateTriggerSubject.next(); 
  }

  private processIncomingBinanceFundingRates(fundingRates: BinanceFuturesFundingRate[]) {
    const updatedSymbols = new Set<string>();
    const now = Date.now();
    let needsUpdateEmit = false;

    for (const item of fundingRates) {
      const symbol = this.cleanSymbol(item.symbol);
      if (!symbol) continue;

      let ticker = this.latestTickerCache.get(symbol) || this.createDefaultProcessedTicker(symbol);

      const rawRate = item.fundingRate;
      const rate = rawRate ? parseFloat(rawRate) : undefined;

      if (rate !== undefined && !isNaN(rate)) {
          ticker.futures.binance.fundingRate = rate;
      }
      ticker.futures.binance.lastUpdatedFR = now; 
      ticker.lastUpdatedOverall = now;

      this.latestTickerCache.set(symbol, ticker);
      updatedSymbols.add(symbol);
      this.queueForRedisUpdate(ticker);
      needsUpdateEmit = true;
    }

    if (needsUpdateEmit) {
      // --- DEĞİŞİKLİK: Doğrudan publish yerine trigger ---
      this.updateTriggerSubject.next();
    }
  }

  private processIncomingBinanceOpenInterest(openInterests: BinanceFuturesOpenInterest[]) {
    const updatedSymbols = new Set<string>();
    const now = Date.now();
    let needsUpdateEmit = false;

    // --- LOG: OI Stream Arrival --- // DEBUG -> VERBOSE
    this.logger.verbose(`[PROCESS_OI_STREAM] Received ${openInterests.length} OI entries from stream.`);

    for (const oiData of openInterests) {
      const cleanedSymbol = this.cleanSymbol(oiData.symbol); // Binance sembolü zaten temiz olmalı ama yine de kontrol edelim
      if (!cleanedSymbol) continue;
      
      // --- LOG: Processing Single OI --- // DEBUG -> VERBOSE
      this.logger.verbose(`[PROCESS_OI_SINGLE] Processing OI for ${cleanedSymbol} (Raw: ${oiData.symbol}). Raw OI string: ${oiData.openInterest}`);

      let ticker = this.latestTickerCache.get(cleanedSymbol);
      if (!ticker) {
         // --- LOG: Ticker Not Found During OI --- // Bu WARN kalsın
         this.logger.warn(`[PROCESS_OI_WARN] Ticker ${cleanedSymbol} not found in cache when processing OI. Skipping.`);
         continue;
      }

      // --- LOG: Attempting Price Lookup --- // DEBUG -> VERBOSE
      this.logger.verbose(`[PROCESS_OI_PRICE] Attempting to determine price for OI calculation for ${cleanedSymbol}.`);
      const priceToUse = this.determinePriceForOi(ticker);
      const oiValueString = oiData.openInterest; // String olarak geliyor
      const oiBaseAsset = parseFloat(oiValueString);

      if (isNaN(oiBaseAsset)) {
          // Bu WARN kalsın
          this.logger.warn(`[PROCESS_OI_WARN] Could not parse OI value (${oiValueString}) for ${cleanedSymbol}. Skipping.`);
          continue;
      }

      const updateTime = oiData.time || now;

      if (priceToUse !== undefined) {
        // --- LOG: Price Found, Processing OI --- // DEBUG -> VERBOSE
        this.logger.verbose(`[PROCESS_OI_SUCCESS] Price found (${priceToUse}) for ${cleanedSymbol}. Calculating USD OI.`);
        const oiUsdValue = oiBaseAsset * priceToUse;

        const binanceFutures = ticker.futures?.binance || {};
        
        ticker = {
            ...ticker,
            futures: {
                ...ticker.futures,
                binance: {
                    ...binanceFutures,
                    openInterest: oiUsdValue,
                    lastUpdatedOI: updateTime,
                }
            },
            lastUpdatedOverall: Math.max(ticker.lastUpdatedOverall || 0, now),
        };

        this.latestTickerCache.set(cleanedSymbol, ticker);
        this.queueForRedisUpdate(ticker);
        updatedSymbols.add(cleanedSymbol);
        
        // Eğer bekleyen varsa temizle (gerçi buraya girdiysek beklemiyordu)
        if (this.pendingBinanceOiUpdates.has(cleanedSymbol)) {
            // DEBUG -> VERBOSE
            this.logger.verbose(`[PROCESS_OI_PENDING_CLEAR] Clearing pending OI for ${cleanedSymbol} as price was found now.`);
            this.pendingBinanceOiUpdates.delete(cleanedSymbol);
        }

        needsUpdateEmit = true;
      } else {
        // --- LOG: Price NOT Found, Pending OI --- // Bu WARN kalsın
        this.logger.warn(`[PROCESS_OI_PENDING] Price NOT found for ${cleanedSymbol}. Adding OI value ${oiBaseAsset} to pending updates.`);
        this.pendingBinanceOiUpdates.set(cleanedSymbol, { oiBaseAsset, timestamp: now });
      }
    }

    if (needsUpdateEmit) {
      this.updateTriggerSubject.next();
    }
  }

  private processIncomingBybitData(bybitData: BybitFundingData[]) {
    const updatedSymbols = new Set<string>();
    const now = Date.now();
    let needsUpdateEmit = false;

    for (const item of bybitData) {
      const symbol = item.symbol;
      if (!symbol) continue;

      // --- DEĞİŞİKLİK: Sadece cache'de varsa güncelle --- 
      let ticker = this.latestTickerCache.get(symbol);
      if (!ticker) {
        // --- DEĞİŞİKLİK: DEBUG -> VERBOSE ---
        this.logger.verbose(`[BybitData] Ticker ${symbol} not found in cache. Skipping update.`);
        continue; // Cache'de yoksa bu veriyi işleme
      }
      // --- BİTTİ: DEĞİŞİKLİK ---
      // Ticker bulunduysa devam et

      // CRASH FIX: Yeni ticker object oluştur (immutable güvenlik)
      const updatedTicker: ProcessedTicker = {
        ...ticker,
        futures: {
          ...ticker.futures,
          binance: ticker.futures?.binance || {},
          bybit: ticker.futures?.bybit || {},
          hyperliquid: ticker.futures?.hyperliquid || {}
        }
      };

      let updated = false;
      if (item.fundingRate !== undefined) {
          updatedTicker.futures.bybit.fundingRate = item.fundingRate;
          updated = true;
      }
      if (item.openInterestValue !== undefined) {
          updatedTicker.futures.bybit.openInterestValue = item.openInterestValue;
          updated = true;
      }

      if (updated) {
        updatedTicker.futures.bybit.lastUpdated = now;
        updatedTicker.lastUpdatedOverall = now;
        this.latestTickerCache.set(symbol, updatedTicker);
        updatedSymbols.add(symbol);
        this.queueForRedisUpdate(updatedTicker);
        needsUpdateEmit = true;
      }
    }
    if (needsUpdateEmit) this.updateTriggerSubject.next();
  }

  private processIncomingHyperLiquidData(hyperliquidData: HyperLiquidFundingData[]) {
      const updatedSymbols = new Set<string>();
      const now = Date.now();
      let needsUpdateEmit = false;
      for (const item of hyperliquidData) {
          const symbolToUse = item.symbol;

          const rate = item.fundingRate;
          const oi = item.openInterestValue;
        // Mark price burada değil, mid price stream'inde

        if (rate === undefined && oi === undefined) continue;

        let ticker = this.latestTickerCache.get(symbolToUse);
        if (!ticker) {
          // --- DEĞİŞİKLİK: Sadece cache'de varsa güncelle --- 
          this.logger.verbose(`[HyperLiquidData] Ticker ${symbolToUse} not found in cache. Skipping update.`);
          continue; // Cache'de yoksa bu veriyi işleme
        }
        
          const updateTime = now;
        // CRASH FIX: Yeni ticker object oluştur (immutable güvenlik)
        const updatedTicker: ProcessedTicker = {
          ...ticker,
          futures: {
            ...ticker.futures,
            binance: ticker.futures?.binance || {},
            bybit: ticker.futures?.bybit || {},
            hyperliquid: ticker.futures?.hyperliquid || {}
          }
        };

        let updated = false;
        if (rate !== undefined) { 
            updatedTicker.futures.hyperliquid.fundingRate = rate;
            updated = true;
        }
        if (oi !== undefined) { 
            updatedTicker.futures.hyperliquid.openInterestValue = oi;
            updated = true;
        } 
        
        if (updated) {
            updatedTicker.futures.hyperliquid.lastUpdated = updateTime;
          updatedTicker.lastUpdatedOverall = Math.max(updatedTicker.lastUpdatedOverall || 0, updateTime);
          this.latestTickerCache.set(symbolToUse, updatedTicker);
          this.queueForRedisUpdate(updatedTicker);
          updatedSymbols.add(symbolToUse);
          needsUpdateEmit = true;
      }
      }
    if (needsUpdateEmit) this.updateTriggerSubject.next();
  }

  private queueForRedisUpdate(ticker: ProcessedTicker) {
      this.redisUpdateQueue.next(ticker);
  }

  private processIncomingBybitSpotTickers(bybitTickers: BybitSpotTickerData[]) {
    const updatedSymbols = new Set<string>();
    const now = Date.now();
    let needsUpdateEmit = false;

    for (const rawTicker of bybitTickers) {
      const symbol = rawTicker.symbol;
      if (!symbol) continue; 
      
      // --- DEĞİŞİKLİK: Sadece cache'de varsa güncelle --- 
      let ticker = this.latestTickerCache.get(symbol);
      if (!ticker) {
         // --- DEĞİŞİKLİK: DEBUG -> VERBOSE ---
         this.logger.verbose(`[BybitSpot] Ticker ${symbol} not found in cache. Skipping update.`);
         continue; // Cache'de yoksa bu veriyi işleme
      }
      // --- BİTTİ: DEĞİŞİKLİK ---
      
      const parsedPrice = parseFloat(rawTicker.lastPrice);
      if (isNaN(parsedPrice) || parsedPrice <= 0) continue;
      
      const bybitSpotData: BybitSpotData = {
        lastPrice: parsedPrice,
        priceChangePercent: parseFloat(rawTicker.price24hPcnt) * 100,
        volume: parseFloat(rawTicker.turnover24h),
        high: parseFloat(rawTicker.highPrice24h),
        low: parseFloat(rawTicker.lowPrice24h),
        lastUpdated: now,
      };

      // CRASH FIX: Yeni ticker object oluştur (immutable güvenlik)
      const updatedTicker: ProcessedTicker = {
        ...ticker,
        spot: {
          ...ticker.spot,
          binance: ticker.spot?.binance || {},
          bybit: bybitSpotData,
        },
        lastUpdatedOverall: now,
      };

      this.latestTickerCache.set(symbol, updatedTicker);
      this.queueForRedisUpdate(updatedTicker);
      updatedSymbols.add(symbol);
      needsUpdateEmit = true;
    }
    if (needsUpdateEmit) this.updateTriggerSubject.next();
  }

  private processIncomingBybitFuturesTickers(bybitTickers: BybitFuturesTickerData[]) {
    const updatedSymbols = new Set<string>();
    const now = Date.now();
    let needsUpdateEmit = false;

    for (const rawTicker of bybitTickers) {
      const symbol = rawTicker.symbol;
      if (!symbol) continue; 
      
      // --- DEĞİŞİKLİK: Sadece cache'de varsa güncelle --- 
      let ticker = this.latestTickerCache.get(symbol);
      if (!ticker) {
        // --- DEĞİŞİKLİK: DEBUG -> VERBOSE ---
        this.logger.verbose(`[BybitFutures] Ticker ${symbol} not found in cache. Skipping update.`);
        continue; // Cache'de yoksa bu veriyi işleme
      }
      // --- BİTTİ: DEĞİŞİKLİK ---
      
      const parsedPrice = parseFloat(rawTicker.lastPrice);
      if (isNaN(parsedPrice) || parsedPrice <= 0) continue;

      // Ensure futures.bybit object exists before spreading
      const existingBybitFutures = ticker.futures?.bybit || {};

      const bybitFuturesData: BybitFuturesData = {
        ...existingBybitFutures, 
        lastPrice: parsedPrice,
        priceChangePercent: parseFloat(rawTicker.price24hPcnt) * 100, 
        volume: parseFloat(rawTicker.turnover24h), 
        high: parseFloat(rawTicker.highPrice24h),
        low: parseFloat(rawTicker.lowPrice24h),
        // Keep existing FR/OI if not provided in this specific ticker update
        fundingRate: rawTicker.fundingRate ? parseFloat(rawTicker.fundingRate) : existingBybitFutures.fundingRate,
        openInterestValue: rawTicker.openInterestValue ? parseFloat(rawTicker.openInterestValue) : existingBybitFutures.openInterestValue,
        lastUpdated: now,
      };

      // CRASH FIX: Yeni ticker object oluştur (immutable güvenlik)
      const updatedTicker: ProcessedTicker = {
        ...ticker,
        futures: {
          ...ticker.futures, 
          binance: ticker.futures?.binance || {},
          bybit: bybitFuturesData, 
          hyperliquid: ticker.futures?.hyperliquid || {}
        },
        lastUpdatedOverall: now,
      };

      this.latestTickerCache.set(symbol, updatedTicker);
      this.queueForRedisUpdate(updatedTicker);
      updatedSymbols.add(symbol);
      needsUpdateEmit = true;
    }
    if (needsUpdateEmit) this.updateTriggerSubject.next();
  }

  private flattenTickerData(ticker: ProcessedTicker): any {
    const binanceSpot = ticker.spot?.binance;
    const bybitSpot = ticker.spot?.bybit;
    const binanceFutures = ticker.futures?.binance;
    const bybitFutures = ticker.futures?.bybit;
    const hyperliquidFutures = ticker.futures?.hyperliquid;
    const coingeckoData = ticker.coingecko;

    // --- DEĞİŞİKLİK: Fiyat belirleme sırası güncellendi (Trade > Mid) ---
    const calculatedLastPrice = 
        binanceFutures?.lastPrice ?? 
        binanceSpot?.lastPrice ?? 
        bybitFutures?.lastPrice ??
        bybitSpot?.lastPrice ??
        hyperliquidFutures?.lastPrice ?? // Öncelik Last Price (Trade)
        hyperliquidFutures?.markPrice; // Sonra Mark Price (Mid)

    // --- YENİ: HyperLiquid OI için USD Hesaplama ---
    let hyperliquidOiUsd: number | undefined = undefined;
    if (hyperliquidFutures?.openInterestValue !== undefined) {
        // Fiyatı bul (lastPrice veya markPrice)
        const priceForHlOi = hyperliquidFutures.lastPrice ?? hyperliquidFutures.markPrice;
        if (priceForHlOi !== undefined) {
            hyperliquidOiUsd = hyperliquidFutures.openInterestValue * priceForHlOi;
        }
    }
    // --- BİTTİ: HyperLiquid OI için USD Hesaplama ---

    const frValues: number[] = [];
    if (binanceFutures?.fundingRate !== undefined) frValues.push(binanceFutures.fundingRate);
    if (bybitFutures?.fundingRate !== undefined) frValues.push(bybitFutures.fundingRate);
    if (hyperliquidFutures?.fundingRate !== undefined) frValues.push(hyperliquidFutures.fundingRate);
    const avgFundingRate = frValues.length > 0 ? frValues.reduce((a, b) => a + b, 0) / frValues.length : undefined;

    const oiValues: number[] = [];
    if (binanceFutures?.openInterest !== undefined) oiValues.push(binanceFutures.openInterest); // Binance zaten USD
    if (bybitFutures?.openInterestValue !== undefined) oiValues.push(bybitFutures.openInterestValue); // Bybit zaten USD
    // --- DEĞİŞİKLİK: Hesaplanan HyperLiquid USD OI kullan ---
    if (hyperliquidOiUsd !== undefined) oiValues.push(hyperliquidOiUsd); 
    const totalOpenInterest = oiValues.length > 0 ? oiValues.reduce((a, b) => a + b, 0) : undefined;

    const fundingRates = {
        binance: binanceFutures?.fundingRate,
        bybit: bybitFutures?.fundingRate,
        hyperliquid: hyperliquidFutures?.fundingRate,
        avg: avgFundingRate, 
    };
    const openInterests = {
        binance: binanceFutures?.openInterest, // USD
        bybit: bybitFutures?.openInterestValue, // USD
        // --- DEĞİŞİKLİK: Hesaplanan HyperLiquid USD OI kullan ---
        hyperliquid: hyperliquidOiUsd, // USD
        total: totalOpenInterest, // USD
    };

    // --- YENİ: Hacim Hesaplaması --- // Toplama Mantığına Dönüyoruz
    const binanceSpotVol = binanceSpot?.volume ?? 0;
    const binanceFuturesVol = binanceFutures?.volume ?? 0;
    const bybitSpotVol = bybitSpot?.volume ?? 0;
    const bybitFuturesVol = bybitFutures?.volume ?? 0;
    // HyperLiquid hacmi şu an yok.
    
    // Ana hacim alanı: Tüm mevcut hacimlerin toplamı
    const calculatedVolume = binanceSpotVol + binanceFuturesVol + bybitSpotVol + bybitFuturesVol;
    // --- BİTTİ: Hacim Hesaplaması --- // Toplama geri döndü

    const categories = getCategoriesForSymbol(ticker.symbol);

    // Orijinal sembolleri al (henüz USDT'li olabilirler)
    const rawBinanceSpotOriginalSymbol = ticker.binanceOriginalSpotSymbol;
    const rawBinanceFuturesOriginalSymbol = ticker.binanceOriginalFuturesSymbol;

    // USDT'yi kaldırarak temiz orijinal sembolleri oluştur
    const cleanedBinanceSpotOriginalSymbol = rawBinanceSpotOriginalSymbol?.replace(/USDT$/, '');
    const cleanedBinanceFuturesOriginalSymbol = rawBinanceFuturesOriginalSymbol?.replace(/USDT$/, '');

    // Varlık Durumu ve URL Hesaplama - Gerçek data varlığına göre kontrol et
    const hasSpot = !!(ticker.spot?.binance?.lastPrice && ticker.spot.binance.lastPrice > 0);
    const hasFutures = !!(ticker.futures?.binance?.lastPrice && ticker.futures.binance.lastPrice > 0);
    let spotUrl: string | undefined = undefined;
    let futuresUrl: string | undefined = undefined;
    const normalizedSymbolForUrl = this.normalizeSymbol(ticker.symbol).toUpperCase(); // Ana (normalize edilmiş) sembol

    if (hasSpot) {
      // Spot URL her zaman normalize edilmiş sembolü kullanır
      spotUrl = `/kripto-paralar/spot/${normalizedSymbolForUrl}`;
    }
    if (hasFutures) {
      // Futures URL için: Eğer orijinal sembol (USDT'siz) rakamla başlıyorsa onu kullan, değilse normalize edilmişi kullan
      if (cleanedBinanceFuturesOriginalSymbol && /^\d+/.test(cleanedBinanceFuturesOriginalSymbol)) {
        futuresUrl = `/kripto-paralar/futures/${cleanedBinanceFuturesOriginalSymbol}`; // USDT'siz prefixli sembol (örn: 1000PEPE)
      } else {
        futuresUrl = `/kripto-paralar/futures/${normalizedSymbolForUrl}`; // Normal sembol (örn: BTC)
      }
    }
    // --- BİTTİ: Varlık Durumu ve URL Hesaplama ---

    return {
      symbol: ticker.symbol,
      normalizedSymbol: normalizedSymbolForUrl,
      // --- DEĞİŞİKLİK: USDT'siz hallerini döndür ---
      binanceSpotOriginalSymbol: cleanedBinanceSpotOriginalSymbol,   // Örn: BTC veya SHIB
      binanceFuturesOriginalSymbol: cleanedBinanceFuturesOriginalSymbol, // Örn: BTC veya 1000PEPE
      // --- BİTTİ ---
      binanceHasSpot: hasSpot,
      binanceHasFutures: hasFutures,
      spotPageUrl: spotUrl,
      futuresPageUrl: futuresUrl,
      lastUpdatedOverall: ticker.lastUpdatedOverall,
      
      lastPrice: calculatedLastPrice,
      binanceSpotPrice: binanceSpot?.lastPrice,
      binanceFuturesPrice: binanceFutures?.lastPrice,
      bybitSpotPrice: bybitSpot?.lastPrice,
      bybitFuturesPrice: bybitFutures?.lastPrice,
      hyperliquidMarkPrice: hyperliquidFutures?.markPrice,
      hyperliquidLastTradePrice: hyperliquidFutures?.lastPrice,

      priceChangePercent: binanceFutures?.priceChangePercent ?? bybitFutures?.priceChangePercent ?? binanceSpot?.priceChangePercent ?? bybitSpot?.priceChangePercent, // Öncelik Futures

      volume: calculatedVolume > 0 ? calculatedVolume : undefined,
      binanceSpotVolume: binanceSpot?.volume,
      binanceFuturesVolume: binanceFutures?.volume,
      bybitSpotVolume: bybitSpot?.volume,
      bybitFuturesVolume: bybitFutures?.volume,

      high: binanceFutures?.high ?? bybitFutures?.high ?? binanceSpot?.high ?? bybitSpot?.high, // Öncelik Futures
      low: binanceFutures?.low ?? bybitFutures?.low ?? binanceSpot?.low ?? bybitSpot?.low,   // Öncelik Futures

      marketCap: coingeckoData?.marketCap,
      marketCapRank: coingeckoData?.marketCapRank,
      circulatingSupply: coingeckoData?.circulatingSupply,
      name: coingeckoData?.name,
      image: coingeckoData?.image,

      fundingRate: avgFundingRate,
      openInterest: totalOpenInterest,
      fundingRates: fundingRates,
      openInterests: openInterests,
      categories: categories,

      // CoinGecko Detayları (Düzleştirilmiş)
      ath: coingeckoData?.ath,
      athChangePercentage: coingeckoData?.athChangePercentage,
      athDate: coingeckoData?.athDate,
      atl: coingeckoData?.atl,
      atlChangePercentage: coingeckoData?.atlChangePercentage,
      atlDate: coingeckoData?.atlDate,
    };
  }

  // --- DEĞİŞİKLİK: Bu fonksiyon kaldırıldı, yerine prepareAndPublishUpdate geldi ---
  // private publishCombinedCacheUpdate() { ... }

  // --- YENİ: Throttling sonrası tetiklenecek ana güncelleme fonksiyonu ---
  private prepareAndPublishUpdate() {
    // DEBUG -> VERBOSE
    this.logger.verbose(`Preparing and publishing throttled update... Cache size: ${this.latestTickerCache.size}`);
    const allTickersNested = this.getAllTickersFromMemory(); // Sıralanmış cache'i al
    
    // Sıralama CoinGecko verisine göre yapılacak
    allTickersNested.sort((a, b) => (b.coingecko?.marketCap ?? 0) - (a.coingecko?.marketCap ?? 0));
    
    const tickersForFrontend = allTickersNested.map(ticker => this.flattenTickerData(ticker));
    
    this.combinedTickerSubject.next(tickersForFrontend);
    
    // --- LOG: Emitting Symbol Update Event --- // DEBUG -> VERBOSE
    const symbols = Array.from(this.latestTickerCache.keys());
    this.logger.verbose(`[EMIT_SYMBOLS] Emitting cache.symbols.updated with ${symbols.length} symbols.`);
    this.eventEmitter.emit('cache.symbols.updated', symbols); 
    
    // DEBUG -> VERBOSE
    this.logger.verbose(`Published update for ${tickersForFrontend.length} tickers via SSE.`);
  }

  private async updateRedisCache(tickersToUpdate: ProcessedTicker[]) {
    if (tickersToUpdate.length === 0) return;
    try {
        const multi = this.redisClient.multi();
        for (const ticker of tickersToUpdate) {
            const key = `ticker:processed:${ticker.symbol}`;
            multi.set(key, JSON.stringify(ticker));
        }
        await multi.exec();
    } catch (error) {
        // this.logger.error('Failed to update Redis cache:', error);
    }
  }

  private async loadInitialCacheFromRedis() {
    try {
      const keys = await this.redisClient.keys(`ticker:processed:*`);
      if (keys.length === 0) {
        // this.logger.log('No existing processed ticker data found in Redis.');
        return;
      }
      const values = await this.redisClient.mget(keys);
      let loadedCount = 0;
      const now = Date.now();
      const expiryThreshold = now - (24 * 60 * 60 * 1000);
      for (const value of values) {
        if (value) {
          try {
            let ticker: ProcessedTicker = JSON.parse(value);
            
            if (!ticker.symbol) continue; 
            if (ticker.lastUpdatedOverall && ticker.lastUpdatedOverall < expiryThreshold) continue; 
            if (!ticker.spot?.binance?.lastPrice || ticker.spot.binance.lastPrice <= 0) continue; 

            ticker.spot = ticker.spot || { binance: {} };
            ticker.spot.binance = ticker.spot.binance || {};
            ticker.futures = ticker.futures || { binance: {}, bybit: {}, hyperliquid: {} };
            ticker.futures.binance = ticker.futures.binance || {};
            ticker.futures.bybit = ticker.futures.bybit || {};
            ticker.futures.hyperliquid = ticker.futures.hyperliquid || {};
            ticker.coingecko = ticker.coingecko || {};
            
            this.latestTickerCache.set(ticker.symbol, ticker); 
            loadedCount++;

          } catch (parseError) {
            // this.logger.warn('Failed to parse processed ticker data from Redis value:', value, parseError);
          }
        }
      }
      // this.logger.log(`Loaded ${loadedCount} processed tickers from Redis into memory cache.`);
      // --- KALDIRILDI: Başlangıçta publish etmeye gerek yok, ilk stream verisi gelince tetiklenir ---
      // if (loadedCount > 0) {
      //   this.publishCombinedCacheUpdate(); // Yerine trigger? Ya da hiç?
      // }
    } catch (error) {
      // this.logger.error('Failed to load initial processed cache from Redis:', error);
    }
  }

  public getAllTickersFromMemory(limit?: number): ProcessedTicker[] {
    const allTickers = Array.from(this.latestTickerCache.values());
    if (limit !== undefined && limit > 0) {
      return allTickers.slice(0, limit);
    } else {
      return allTickers;
    }
  }

  public getAllFlattenedTickers(): any[] {
     const allTickersNested = this.getAllTickersFromMemory();
     return allTickersNested.map(ticker => this.flattenTickerData(ticker));
  }

  public getTickerBySymbolFromMemory(symbol: string): ProcessedTicker | undefined {
    const ticker = this.latestTickerCache.get(symbol);
    if (!ticker) return undefined;
    
    // Check if any price source is available
    const hasPrice = ticker.spot?.binance?.lastPrice || 
                    ticker.spot?.bybit?.lastPrice ||
                    ticker.futures?.binance?.lastPrice ||
                    ticker.futures?.bybit?.lastPrice ||
                    ticker.futures?.hyperliquid?.markPrice ||
                    ticker.futures?.hyperliquid?.lastPrice;
    
    return hasPrice ? ticker : undefined;
  }

  onModuleDestroy() {
    this.logger.log('Cleaning up CacheUpdateService subscriptions...');
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.redisUpdateSubscription?.unsubscribe();
    // --- DEĞİŞİKLİK: Throttled subscription'ı da temizle ---
    this.throttledUpdateSubscription?.unsubscribe(); 
  }

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'fastCoinGeckoUpdate' })
  async handleFastCoinGeckoUpdate() {
    this.logger.log('[CRON-CG-FAST START] handleFastCoinGeckoUpdate Cron job started.');
    // --- YENİ: Tüm Cron içeriğini try...catch içine al --- 
    try {
      this.logger.log('[CRON-CG-Fast] Fast market data update started.');
      const marketData: CoinGeckoMarketData[] = await this.coinGeckoService.getMarketData(250, 1);

      if (!marketData || marketData.length === 0) {
        this.logger.warn('[CRON-CG-Fast] No market data received from CoinGecko (Page 1).');
        return;
      }
      this.logger.log(`[CRON-CG-Fast] Received ${marketData.length} market data entries.`);
      this.processIncomingCoinGeckoData(marketData);
    } catch (error) {
       this.logger.error('[CRON-CG-Fast] CRON JOB FAILED:', error?.message, error?.stack);
    }
    // --- BİTTİ: try...catch ---
  }

  // YENİ: Daha seyrek çalışan, eksikleri tamamlayan CoinGecko güncelleyici
  @Cron(CronExpression.EVERY_HOUR, { name: 'slowCoinGeckoUpdate' })
  async handleSlowCoinGeckoUpdate() {
    this.logger.log('[CRON-CG-SLOW START] handleSlowCoinGeckoUpdate Cron job started.');
    // --- YENİ: Tüm Cron içeriğini try...catch içine al --- 
    try {
    this.logger.log('[CRON-CG-Slow] Slow update for missing CoinGecko data started.');
    const symbolsInCache = Array.from(this.latestTickerCache.keys());
    const symbolsToUpdate: string[] = [];

    for (const symbol of symbolsInCache) {
      const ticker = this.latestTickerCache.get(symbol);
      if (ticker && (!ticker.coingecko?.marketCap || ticker.coingecko.marketCap <= 0)) {
        symbolsToUpdate.push(symbol);
      }
    }

    if (symbolsToUpdate.length === 0) {
      this.logger.log('[CRON-CG-Slow] No symbols found missing CoinGecko market cap data.');
      return;
    }

    this.logger.log(`[CRON-CG-Slow] Found ${symbolsToUpdate.length} symbols to fetch details for: ${symbolsToUpdate.slice(0, 10).join(', ')}...`);

    let updatedCount = 0;
      const delayBetweenRequests = 5000; // 5 saniye bekleme

    for (const symbol of symbolsToUpdate) {
      try {
        this.logger.debug(`[CRON-CG-Slow] Fetching details for ${symbol}...`);
        const coinDetails = await this.coinGeckoService.getCoinDetails(symbol);

          // --- LINTER FIX: Ticker değişkenini burada tekrar alalım --- 
          const ticker = this.latestTickerCache.get(symbol);
          if (!ticker) { // Ticker bir şekilde kaybolmuş olabilir, tekrar kontrol et
            this.logger.warn(`[CRON-CG-Slow] Ticker ${symbol} disappeared from cache during slow update.`);
            continue; 
          }
          // --- BİTTİ: LINTER FIX ---
          
          if (coinDetails?.market_data?.market_cap?.usd) {
            const tickerDataFromCoinGecko: Partial<typeof ticker.coingecko> = {};
            // --- LINTER FIX: market_data alanlarına erişirken 'any' kullan --- 
            const marketData = coinDetails.market_data as any; // Tip kontrolünü bypass et

            tickerDataFromCoinGecko.name = coinDetails.name ?? ticker.coingecko?.name;
            tickerDataFromCoinGecko.image = coinDetails.image?.small || ticker.coingecko?.image;
            tickerDataFromCoinGecko.marketCap = marketData?.market_cap?.usd ?? ticker.coingecko?.marketCap;
            tickerDataFromCoinGecko.marketCapRank = marketData?.market_cap_rank ?? ticker.coingecko?.marketCapRank;
            tickerDataFromCoinGecko.circulatingSupply = marketData?.circulating_supply ?? ticker.coingecko?.circulatingSupply;
            tickerDataFromCoinGecko.totalSupply = marketData?.total_supply ?? ticker.coingecko?.totalSupply;
            tickerDataFromCoinGecko.maxSupply = marketData?.max_supply ?? ticker.coingecko?.maxSupply;
            tickerDataFromCoinGecko.ath = marketData?.ath?.usd ?? ticker.coingecko?.ath;
            tickerDataFromCoinGecko.athChangePercentage = marketData?.ath_change_percentage?.usd ?? ticker.coingecko?.athChangePercentage;
            tickerDataFromCoinGecko.athDate = marketData?.ath_date?.usd ?? ticker.coingecko?.athDate;
            tickerDataFromCoinGecko.atl = marketData?.atl?.usd ?? ticker.coingecko?.atl;
            tickerDataFromCoinGecko.atlChangePercentage = marketData?.atl_change_percentage?.usd ?? ticker.coingecko?.atlChangePercentage;
            tickerDataFromCoinGecko.atlDate = marketData?.atl_date?.usd ?? ticker.coingecko?.atlDate;
            tickerDataFromCoinGecko.priceChangePercentage24h = marketData?.price_change_percentage_24h ?? ticker.coingecko?.priceChangePercentage24h;
            const lastUpdatedRaw = marketData?.last_updated;
            // --- BİTTİ: LINTER FIX ---
            const lastUpdatedTimestamp = lastUpdatedRaw ? Date.parse(lastUpdatedRaw) : Date.now();
            tickerDataFromCoinGecko.lastUpdated = lastUpdatedTimestamp;
            
            // Remove undefined properties before merging
             Object.keys(tickerDataFromCoinGecko).forEach(key => {
                const typedKey = key as keyof typeof tickerDataFromCoinGecko;
                if (tickerDataFromCoinGecko[typedKey] === undefined || (typeof tickerDataFromCoinGecko[typedKey] === 'number' && isNaN(tickerDataFromCoinGecko[typedKey]))) {
                    delete tickerDataFromCoinGecko[typedKey];
               }
             });
            // --- BİTTİ: LINTER FIX --- 

            ticker.coingecko = { ...(ticker.coingecko || {}), ...tickerDataFromCoinGecko };
            ticker.lastUpdatedOverall = Date.now();
            this.latestTickerCache.set(symbol, ticker);
            this.queueForRedisUpdate(ticker);
            updatedCount++;
            this.logger.debug(`[CRON-CG-Slow] Updated CoinGecko data for ${symbol}`);
        } else {
           this.logger.warn(`[CRON-CG-Slow] No market cap data found for ${symbol} via getCoinDetails.`);
        }
        } catch (innerError) { 
          if (innerError instanceof NotFoundException) {
             this.logger.warn(`[CRON-CG-Slow INNER CATCH] Coin details not found on CoinGecko for symbol ${symbol}.`);
        } else {
             this.logger.error(`[CRON-CG-Slow INNER CATCH] Error fetching details for ${symbol}:`, innerError?.message);
        }
        } finally {
         await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
      }
      } // for döngüsü sonu

    this.logger.log(`[CRON-CG-Slow] Slow update finished. Updated CoinGecko data for ${updatedCount} symbols.`);
    if (updatedCount > 0) {
        this.updateTriggerSubject.next();
    }
    } catch (error) {
      this.logger.error('[CRON-CG-Slow] CRON JOB FAILED:', error?.message, error?.stack);
    }
    // --- BİTTİ: try...catch ---
  }

  private processIncomingCoinGeckoData(marketData: CoinGeckoMarketData[]) {
    this.logger.log(`[CRON-CG-Process] processIncomingCoinGeckoData started with ${marketData.length} entries.`);
    const updatedSymbols = new Set<string>();
    const now = Date.now();
    let needsUpdateEmit = false;
    let processedCount = 0;
    // let createdCount = 0; // Artık yeni oluşturmuyoruz

    for (const coin of marketData) {
      if (!coin.symbol) continue;
      const upperSymbol = coin.symbol.toUpperCase();
      
      // --- DEĞİŞİKLİK: Sadece cache'de varsa güncelle --- 
      let existingTicker = this.latestTickerCache.get(upperSymbol);
      if (!existingTicker) {
        // --- DEĞİŞİKLİK: DEBUG -> VERBOSE ---
        this.logger.verbose(`[CoinGecko] Ticker ${upperSymbol} not found in cache. Skipping update.`);
        continue; // Cache'de yoksa bu veriyi işleme
      }
      // --- BİTTİ: DEĞİŞİKLİK ---
      
        processedCount++;
      const tickerToUpdate = existingTicker; // Artık hep var olanı güncelliyoruz
      const tickerUpdateFromCoinGecko: Partial<typeof tickerToUpdate.coingecko> = {};

      // ... (data atama kısmı aynı) ...
      tickerUpdateFromCoinGecko.name = coin.name ?? tickerToUpdate.coingecko?.name;
      tickerUpdateFromCoinGecko.image = coin.image ?? tickerToUpdate.coingecko?.image;
      tickerUpdateFromCoinGecko.marketCap = coin.market_cap ?? tickerToUpdate.coingecko?.marketCap;
      tickerUpdateFromCoinGecko.marketCapRank = coin.market_cap_rank ?? tickerToUpdate.coingecko?.marketCapRank;
      tickerUpdateFromCoinGecko.circulatingSupply = coin.circulating_supply ?? tickerToUpdate.coingecko?.circulatingSupply;
      tickerUpdateFromCoinGecko.totalSupply = coin.total_supply ?? tickerToUpdate.coingecko?.totalSupply;
      tickerUpdateFromCoinGecko.maxSupply = coin.max_supply ?? tickerToUpdate.coingecko?.maxSupply;
      tickerUpdateFromCoinGecko.ath = coin.ath ?? tickerToUpdate.coingecko?.ath;
      tickerUpdateFromCoinGecko.athChangePercentage = coin.ath_change_percentage ?? tickerToUpdate.coingecko?.athChangePercentage;
      tickerUpdateFromCoinGecko.athDate = coin.ath_date ?? tickerToUpdate.coingecko?.athDate;
      tickerUpdateFromCoinGecko.atl = coin.atl ?? tickerToUpdate.coingecko?.atl;
      tickerUpdateFromCoinGecko.atlChangePercentage = coin.atl_change_percentage ?? tickerToUpdate.coingecko?.atlChangePercentage;
      tickerUpdateFromCoinGecko.atlDate = coin.atl_date ?? tickerToUpdate.coingecko?.atlDate;
      tickerUpdateFromCoinGecko.priceChangePercentage24h = coin.price_change_percentage_24h ?? tickerToUpdate.coingecko?.priceChangePercentage24h;
      tickerUpdateFromCoinGecko.lastUpdated = coin.last_updated ? Date.parse(coin.last_updated) : now;

      Object.keys(tickerUpdateFromCoinGecko).forEach(key => {
         const typedKey = key as keyof typeof tickerUpdateFromCoinGecko;
         const newValue = tickerUpdateFromCoinGecko[typedKey];
         if (newValue === null || newValue === undefined || (typeof newValue === 'number' && isNaN(newValue))) {
             delete tickerUpdateFromCoinGecko[typedKey];
          }
         });

        // Mevcut coingecko verisiyle birleştirerek güncelle
      tickerToUpdate.coingecko = { ...(tickerToUpdate.coingecko || {}), ...tickerUpdateFromCoinGecko };
      tickerToUpdate.lastUpdatedOverall = now;
      this.latestTickerCache.set(upperSymbol, tickerToUpdate);
      this.queueForRedisUpdate(tickerToUpdate);
        updatedSymbols.add(upperSymbol);
        needsUpdateEmit = true;
    }

    this.logger.log(`[CRON-CG-Process] processIncomingCoinGeckoData finished. Processed ${processedCount} existing tickers. Needs emit: ${needsUpdateEmit}`);

    if (needsUpdateEmit) {
        this.updateTriggerSubject.next();
    }
  }

  private emitSymbolListUpdate() {
    const symbols = Array.from(this.latestTickerCache.keys());
    this.eventEmitter.emit('cache.symbols.updated', symbols);
    // this.logger.debug(`Emitted cache.symbols.updated with ${symbols.length} symbols.`);
  }

  // YENİ: Belirli aralıklarla eski bekleyen OI güncellemelerini temizle
  private startPendingOiCleanup() {
      setInterval(() => {
          const now = Date.now();
          let cleanedCount = 0;
          for (const [symbol, pendingUpdate] of this.pendingBinanceOiUpdates.entries()) {
              // PENDING_OI_TIMEOUT_MS defined in class properties
              if (now - pendingUpdate.timestamp > this.PENDING_OI_TIMEOUT_MS) {
                  this.pendingBinanceOiUpdates.delete(symbol);
                  cleanedCount++;
              }
          }
          if (cleanedCount > 0) {
              this.logger.debug(`Cleaned up ${cleanedCount} expired pending Binance OI updates.`);
          }
      }, this.PENDING_OI_TIMEOUT_MS / 2); 
  }

  private tryProcessPendingOi(symbol: string, updatedTicker: ProcessedTicker): ProcessedTicker {
      const pendingOi = this.pendingBinanceOiUpdates.get(symbol);
      if (pendingOi) {
          // --- LOG: Attempting to Process Pending OI --- // DEBUG -> VERBOSE
          this.logger.verbose(`[PROCESS_PENDING_OI_TRY] Found pending OI for ${symbol} after price update. Attempting to process... Base OI: ${pendingOi.oiBaseAsset}`);
          const priceToUse = this.determinePriceForOi(updatedTicker);
          if (priceToUse !== undefined) {
              // --- LOG: Price Found for Pending OI --- // DEBUG -> VERBOSE
              const oiUsdValue = pendingOi.oiBaseAsset * priceToUse;
              this.logger.verbose(`[PROCESS_PENDING_OI_SUCCESS] Price found (${priceToUse}) for pending OI for ${symbol}. Calculated USD OI: ${oiUsdValue}.`);
              
              const binanceFutures = updatedTicker.futures?.binance || {};
              const now = Date.now();
              
              const updatedBinanceFuturesData = {
                  ...binanceFutures,
                  openInterest: oiUsdValue,
                  lastUpdatedOI: now, // Specifically update OI timestamp
              };

              const tickerWithOi: ProcessedTicker = {
                  ...updatedTicker,
                  futures: {
                      ...updatedTicker.futures,
                      binance: updatedBinanceFuturesData
                  },
                  lastUpdatedOverall: Math.max(updatedTicker.lastUpdatedOverall || 0, now)
              };
              
              this.pendingBinanceOiUpdates.delete(symbol);
              // DEBUG -> VERBOSE
              this.logger.verbose(`[PROCESS_PENDING_OI_CLEAR] Successfully processed and cleared pending OI for ${symbol}.`);
              return tickerWithOi; // Return the ticker with OI processed
          } else {
              // --- LOG: Price STILL Not Found for Pending OI --- // Bu WARN kalsın
              this.logger.warn(`[PROCESS_PENDING_OI_FAIL] Price STILL not found for pending OI for ${symbol} even after price update. It might expire.`);
          }
      }
      return updatedTicker; // Return original ticker if no pending OI or no price found
  }

  private determinePriceForOi(ticker: ProcessedTicker): number | undefined {
      // Öncelik: Binance Futures Last Price > Binance Spot Last Price
      // --- GÜNCELLENMİŞ LOG: Fiyat Kontrolleri --- // DEBUG -> VERBOSE
      const futuresPrice = ticker.futures?.binance?.lastPrice;
      const spotPrice = ticker.spot?.binance?.lastPrice;
      this.logger.verbose(`[DETERMINE_PRICE_OI ${ticker.symbol}] Checking Prices - Futures: ${futuresPrice}, Spot: ${spotPrice}`);
      
      if (futuresPrice && futuresPrice > 0) {
          // DEBUG -> VERBOSE
          this.logger.verbose(`[DETERMINE_PRICE_OI ${ticker.symbol}] Using Binance Futures Last Price: ${futuresPrice}`);
          return futuresPrice;
      } 
      
      if (spotPrice && spotPrice > 0) {
          // DEBUG -> VERBOSE
          this.logger.verbose(`[DETERMINE_PRICE_OI ${ticker.symbol}] Using Binance Spot Price: ${spotPrice}`);
          return spotPrice;
      }
      // --- BİTTİ: GÜNCELLENMİŞ LOG --- // Bu WARN'ı VERBOSE'a çevir
      this.logger.verbose(`[DETERMINE_PRICE_OI ${ticker.symbol}] No valid Last Price (Futures or Spot) found for OI conversion.`);
      return undefined;
  }

  private processIncomingHyperLiquidTrade(trade: HyperLiquidTradeData) {
    const symbol = trade.symbol; 
    if (!symbol) return;

    let ticker = this.latestTickerCache.get(symbol);
    if (!ticker) {
      // --- DEĞİŞİKLİK: Sadece cache'de varsa güncelle --- 
      this.logger.verbose(`[HyperLiquidTrade] Ticker ${symbol} not found in cache. Skipping update.`);
      return; // Cache'de yoksa bu veriyi işleme (next()'i tetikleme)
    }
    
    const now = Date.now();
    
    // CRASH FIX: Yeni ticker object oluştur (immutable güvenlik)
    const updatedTicker: ProcessedTicker = {
      ...ticker,
      futures: {
        ...ticker.futures,
        binance: ticker.futures?.binance || {},
        bybit: ticker.futures?.bybit || {},
        hyperliquid: {
          ...ticker.futures?.hyperliquid || {},
          lastPrice: trade.lastPrice, 
          lastUpdatedTrade: now, 
        }
      },
      lastUpdatedOverall: Math.max(ticker.lastUpdatedOverall || 0, now)
    };

    this.latestTickerCache.set(symbol, updatedTicker);
    this.queueForRedisUpdate(updatedTicker);
    this.updateTriggerSubject.next(); 
  }

  // --- YENİ: HyperLiquid Mid Price işleme metodu ---
  private processIncomingHyperLiquidMidPrices(midPriceUpdates: HyperLiquidMidPriceData[]) {
      const updatedSymbols = new Set<string>();
      const now = Date.now();
      let needsUpdateEmit = false;

      for (const update of midPriceUpdates) {
          const symbol = update.symbol;
          if (!symbol) continue;

          let ticker = this.latestTickerCache.get(symbol);
          if (!ticker) {
            // --- DEĞİŞİKLİK: Sadece cache'de varsa güncelle --- 
            this.logger.verbose(`[HyperLiquidMidPrice] Ticker ${symbol} not found in cache. Skipping update.`);
            continue; // Cache'de yoksa bu veriyi işleme
          }
          
          // CRASH FIX: Yeni ticker object oluştur (immutable güvenlik)
          const updatedTicker: ProcessedTicker = {
            ...ticker,
            futures: {
              ...ticker.futures,
              binance: ticker.futures?.binance || {},
              bybit: ticker.futures?.bybit || {},
              hyperliquid: {
                ...ticker.futures?.hyperliquid || {},
                markPrice: update.midPrice,
                lastUpdated: now, // Genel HL güncelleme zamanı (ticker veya fr/oi ile birleşebilir)
              }
            },
            lastUpdatedOverall: Math.max(ticker.lastUpdatedOverall || 0, now)
          };

          this.latestTickerCache.set(symbol, updatedTicker);
          this.queueForRedisUpdate(updatedTicker);
          updatedSymbols.add(symbol);
          needsUpdateEmit = true;
      }
      
      if (needsUpdateEmit) {
          this.updateTriggerSubject.next();
      }
  }

  // getOrCreateTicker, batchUpdateCacheAndEmit vb. aynı kalabilir veya düzenlenebilir
  // ... (kalan metodlar) ...
  private getOrCreateTicker(normalizedSymbol: string): ProcessedTicker {
    let ticker = this.latestTickerCache.get(normalizedSymbol);
    if (!ticker) {
      // Yeni ticker oluştur - complete structure ile
      const newTicker: ProcessedTicker = {
        symbol: normalizedSymbol,
        normalizedSymbol,
        lastUpdatedOverall: Date.now(),
        lastUpdated: Date.now(),
        source: 'combined',
        spot: {
          binance: {}
        },
        futures: {
          binance: {},
          bybit: {},
          hyperliquid: {}
        },
        coingecko: {}
      };
      this.latestTickerCache.set(normalizedSymbol, newTicker);
      return newTicker;
    }
    // Ensure nested structures exist (might be created partially)
    if (!ticker.spot) ticker.spot = {};
    if (!ticker.spot.binance) ticker.spot.binance = {};
    if (!ticker.futures) ticker.futures = {};
    if (!ticker.futures.binance) ticker.futures.binance = {};
    if (!ticker.futures.bybit) ticker.futures.bybit = {};
    if (!ticker.futures.hyperliquid) ticker.futures.hyperliquid = {};
    if (!ticker.coingecko) ticker.coingecko = {};
    return ticker;
  }

  // ... (rest of the code)

}