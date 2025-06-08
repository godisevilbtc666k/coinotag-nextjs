import { Module } from '@nestjs/common';
import { MarketStatsController } from './market-stats.controller';
import { MarketStatsService } from './market-stats.service';
import { ProcessingModule } from '../../processing/processing.module';

@Module({
  imports: [ProcessingModule],
  controllers: [MarketStatsController],
  providers: [MarketStatsService],
  exports: [MarketStatsService]
})
export class MarketStatsModule {}

export interface GlobalMarketStats {
  totalMarketCap: number;
  totalVolume24h: number;
  btcDominance: number | null;
  totalCoins: number;
  lastUpdated: number;
}
