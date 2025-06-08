import { Module } from '@nestjs/common';
import { TechnicalAnalysisModule } from './technical-analysis/technical-analysis.module'; // Eğer varsa
import { MarketStatsModule } from './market-stats/market-stats.module';
// import { AlertsModule } from './alerts/alerts.module'; // Eğer varsa

@Module({
  imports: [
     TechnicalAnalysisModule, // Eğer varsa
     MarketStatsModule,
     // AlertsModule, // Eğer varsa
    ],
  exports: [
     TechnicalAnalysisModule, // Eğer varsa
     MarketStatsModule,
     // AlertsModule, // Eğer varsa
    ],
})
export class FeaturesModule {}
