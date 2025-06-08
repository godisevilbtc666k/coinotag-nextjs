import { Injectable, Logger } from '@nestjs/common';
import { CacheUpdateService } from '../../processing/cache-update/cache-update.service';
import { GlobalMarketStats } from './market-stats.types';

@Injectable()
export class MarketStatsService {
  private readonly logger = new Logger(MarketStatsService.name);

  constructor(private readonly cacheUpdateService: CacheUpdateService) {}

  calculateGlobalStats(): GlobalMarketStats {
    this.logger.log('Calculating global market stats...');
    const allTickers = this.cacheUpdateService.getAllFlattenedTickers(); 
    const totalCoins = allTickers.length;
    let totalMarketCap = 0;
    let totalVolume24h = 0;
    let btcMarketCap: number | null = null;

    for (const ticker of allTickers) {
      const marketCap = ticker.marketCap;
      const volume = ticker.volume; 

      if (marketCap && marketCap > 0) {
        totalMarketCap += marketCap;
        if (ticker.symbol === 'BTC') {
          btcMarketCap = marketCap;
        }
      }
      if (volume && volume > 0) {
        totalVolume24h += volume;
      }
    }

    const btcDominance =
      btcMarketCap && totalMarketCap > 0
        ? (btcMarketCap / totalMarketCap) * 100
        : null;

    const stats: GlobalMarketStats = {
      totalMarketCap,
      totalVolume24h,
      btcDominance,
      totalCoins,
      lastUpdated: Date.now(),
    };
    this.logger.log(`Global stats calculated: ${JSON.stringify(stats)}`);
    return stats;
  }
} 