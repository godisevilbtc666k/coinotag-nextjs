import { Controller, Get, Logger } from '@nestjs/common';
import { MarketStatsService } from './market-stats.service';
import { GlobalMarketStats } from './market-stats.types';

@Controller('market/stats') // Endpoint'i tanımla
export class MarketStatsController {
  private readonly logger = new Logger(MarketStatsController.name);

  constructor(private readonly marketStatsService: MarketStatsService) {}

  @Get() // GET isteği için decorator
  getGlobalStats(): GlobalMarketStats {
    this.logger.log('Received request for /market/stats');
    // Servis üzerinden hesaplanmış istatistikleri döndür
    return this.marketStatsService.calculateGlobalStats();
  }
}
