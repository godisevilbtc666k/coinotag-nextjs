import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { RedisClientType } from 'redis';
import { firstValueFrom } from 'rxjs';
import { DIRECT_REDIS_CLIENT } from '../../redis/redis.constants';
import { CoinGeckoCoinDetail, CoinGeckoMarketData, SymbolToCoinGeckoIdMap } from './coingecko.types';
import { AxiosError } from 'axios';

@Injectable()
export class CoinGeckoService {
  private readonly logger = new Logger(CoinGeckoService.name);
  private readonly baseUrl = 'https://api.coingecko.com/api/v3';
  // Basit bir eşleştirme, idealde bu dışarıdan veya config'den yönetilebilir
  private readonly symbolToIdMap: SymbolToCoinGeckoIdMap = {
    BTC: 'bitcoin',
    ETH: 'ethereum',
    SOL: 'solana',
    BNB: 'binancecoin',
    XRP: 'ripple',
    DOGE: 'dogecoin',
    SHIB: 'shiba-inu',
    DOT: 'polkadot',
    AVAX: 'avalanche-2',
    MATIC: 'matic-network',
    // ... diğer popüler coinler eklenebilir
    // TODO: Bu listeyi daha dinamik veya kapsamlı hale getir
  };
  private readonly marketCacheTtlSeconds = 60 * 10; // 10 dakika market verisi cache
  private readonly detailsCacheTtlSeconds = 60 * 30; // 30 dakika detay cache (daha seyrek değişir)

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService, // API key vs. gerekirse diye
    @Inject(DIRECT_REDIS_CLIENT) private readonly redisClient: RedisClientType,
  ) {}

  private getCoinGeckoIdForSymbol(symbol: string): string | null {
    const upperSymbol = symbol.toUpperCase();
    return this.symbolToIdMap[upperSymbol] || null;
  }

  async getCoinDetails(symbol: string): Promise<CoinGeckoCoinDetail | null> {
    const coinId = this.getCoinGeckoIdForSymbol(symbol);
    if (!coinId) {
      this.logger.warn(`No CoinGecko ID found for symbol: ${symbol}`);
      // throw new NotFoundException(`CoinGecko ID not found for symbol: ${symbol}`);
      // Veya sadece null dönelim ki controller 404 versin
      return null;
    }

    const cacheKey = `coingecko:details:${coinId}`;

    try {
      // 1. Cache'i kontrol et
      const cachedData = await this.redisClient.get(cacheKey);
      if (cachedData && typeof cachedData === 'string') {
        this.logger.debug(`Cache hit for CoinGecko details: ${coinId}`);
        return JSON.parse(cachedData) as CoinGeckoCoinDetail;
      }

      // 2. Cache'de yoksa API'ye istek at
      this.logger.debug(`Cache miss for CoinGecko details: ${coinId}. Fetching from API...`);
      const apiUrl = `${this.baseUrl}/coins/${coinId}`;
      const response = await firstValueFrom(
        this.httpService.get<CoinGeckoCoinDetail>(apiUrl, {
          params: {
            localization: 'false', // Açıklamaların hepsini almak için false (veya tr?)
            tickers: 'false', // Ticker verisi istemiyoruz
            market_data: 'true', // Market verisi istiyoruz
            community_data: 'false', // Topluluk verisi istemiyoruz
            developer_data: 'false', // Geliştirici verisi istemiyoruz
            sparkline: 'false', // Sparkline istemiyoruz
          },
        }),
      );

      if (response.status === 200 && response.data) {
        const coinData = response.data;
        // 3. Başarılı yanıtı cache'le
        await this.redisClient.set(cacheKey, JSON.stringify(coinData), {
          EX: this.detailsCacheTtlSeconds,
        });
        this.logger.log(`Fetched and cached CoinGecko details for: ${coinId}`);
        return coinData;
      } else {
        this.logger.error(`Failed to fetch CoinGecko details for ${coinId}. Status: ${response.status}`);
        return null; // Hata durumunda null dön
      }
    } catch (error) {
      if (error instanceof AxiosError && error.response?.status === 404) {
        this.logger.warn(`CoinGecko API returned 404 for coin ID: ${coinId}`);
        // 404 durumunda da cache'e kısa süreliğine null yazılabilir (negatif cache)
        // await this.redisClient.set(cacheKey, JSON.stringify(null), { EX: 60 }); // 1 dk
        throw new NotFoundException(`Coin details not found on CoinGecko for ID: ${coinId}`);
      }
      this.logger.error(`Error fetching or caching CoinGecko details for ${coinId}:`, error);
      // Genel hata durumunda null dönmek yerine hatayı yukarı fırlatmak daha iyi olabilir
      throw error; // Veya daha spesifik bir hata nesnesi
    }
  }

  // Yeni Metod: Toplu Market Verisi Çekme
  async getMarketData(perPage: number = 250, page: number = 1): Promise<CoinGeckoMarketData[]> {
    const cacheKey = `coingecko:markets:page${page}:perPage${perPage}`;
    const vsCurrency = 'usd'; // Karşılaştırma para birimi
    let apiUrl: string; // Define apiUrl outside the try block

    try {
      // 1. Cache'i kontrol et
      const cachedData = await this.redisClient.get(cacheKey);
      if (cachedData && typeof cachedData === 'string') {
        this.logger.verbose(`Cache hit for CoinGecko markets: ${cacheKey}`);
        return JSON.parse(cachedData) as CoinGeckoMarketData[];
      }

      // 2. Cache'de yoksa API'ye istek at
      this.logger.debug(`Cache miss for CoinGecko markets: ${cacheKey}. Fetching from API...`);
      apiUrl = `${this.baseUrl}/coins/markets`; // Assign value inside the try block
      const response = await firstValueFrom(
        this.httpService.get<CoinGeckoMarketData[]>(apiUrl, {
          params: {
            vs_currency: vsCurrency,
            order: 'market_cap_desc', // Piyasa değerine göre sırala
            per_page: perPage,
            page: page,
            sparkline: 'false',
            locale: 'en', // İngilizce veri alalım
          },
          timeout: 15000, // İstek zaman aşımını biraz artıralım
        }),
      );

      if (response.status === 200 && Array.isArray(response.data)) {
        const marketData = response.data;
        // 3. Başarılı yanıtı cache'le
        await this.redisClient.set(cacheKey, JSON.stringify(marketData), {
          EX: this.marketCacheTtlSeconds,
        });
        this.logger.log(`Fetched and cached ${marketData.length} market data entries from CoinGecko.`);
        return marketData;
      } else {
        this.logger.error(`Failed to fetch CoinGecko market data. Status: ${response.status}`);
        return []; // Hata durumunda boş dizi dön
      }
    } catch (error) {
      this.logRestError('getMarketData', apiUrl, error); // apiUrl artık erişilebilir
      // Hatanın loglanması yeterli, yukarıya tekrar fırlatalım
      throw error;
    }
  }

  // Hata loglama fonksiyonu - parametre adı 'url' olmalı
  private logRestError(context: string, url: string, error: any) {
    if (error instanceof AxiosError) {
      this.logger.error(
        `Axios Error in CoinGeckoService ${context} calling ${url}: Status ${error.response?.status}, Data: ${JSON.stringify(error.response?.data)}`,
        error.stack,
      );
    } else {
      this.logger.error(`Error in CoinGeckoService ${context} calling ${url}:`, error);
    }
  }
} 