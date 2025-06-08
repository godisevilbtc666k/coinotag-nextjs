import { Controller, Get, Logger, Query, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { CacheUpdateService } from '../../processing/cache-update/cache-update.service';
import { ProcessedTicker } from '../../processing/cache-update/cache-update.types';

@Controller('tickers')
export class TickersController {
  private readonly logger = new Logger(TickersController.name);

  constructor(private readonly cacheUpdateService: CacheUpdateService) {}

  @Get()
  getAllTickers(
    @Query(
      'limit',
      // Limit yoksa veya geçersizse null döndür, servis tümünü sıralı getirir
      new DefaultValuePipe(undefined),
      // Gelen değeri sayıya çevir, değilse hata ver (ValidationPipe ile daha iyisi yapılabilir)
      new ParseIntPipe({ optional: true })
    )
    limit?: number,
  ): ProcessedTicker[] {
    this.logger.log(`Request received for tickers${limit ? ` (limit: ${limit})` : ' (no limit)'}`);
    try {
      // Servise limit parametresini gönder
      const tickers = this.cacheUpdateService.getAllTickersFromMemory(limit);
      this.logger.log(`Returning ${tickers.length} tickers (requested limit: ${limit ?? 'none'}).`);
      return tickers;
    } catch (error) {
      this.logger.error('Error retrieving tickers from memory cache:', error);
      // Hata durumunda boş dizi veya uygun bir hata kodu dönülebilir.
      // throw new InternalServerErrorException('Could not retrieve ticker data.');
      return [];
    }
  }
} 