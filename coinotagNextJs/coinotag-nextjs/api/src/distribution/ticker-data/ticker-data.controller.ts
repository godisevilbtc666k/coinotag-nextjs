import { Controller, Get, Inject, Logger, NotFoundException, Param } from '@nestjs/common';
import { CacheUpdateService } from '../../processing/cache-update/cache-update.service';
import { ProcessedTicker } from '../../processing/cache-update/cache-update.types';

@Controller('api/v1/tickers')
export class TickerDataController {
  private readonly logger = new Logger(TickerDataController.name);

  constructor(
    private readonly cacheUpdateService: CacheUpdateService
  ) {}

  @Get(':symbol')
  getTickerBySymbol(@Param('symbol') symbol: string): ProcessedTicker {
    this.logger.debug(`REST request received for ticker: ${symbol}`);
    const upperSymbol = symbol.toUpperCase(); // Ensure uppercase symbol
    const ticker = this.cacheUpdateService.getTickerBySymbolFromMemory(upperSymbol);

    if (!ticker) {
      this.logger.warn(`Ticker not found in cache for symbol: ${upperSymbol}`);
      throw new NotFoundException(`Ticker data not found for symbol: ${upperSymbol}`);
    }

    this.logger.debug(`Returning ticker data for: ${upperSymbol}`);
    return ticker;
  }

  // Gelecekte tüm tickerları listeleyen bir endpoint eklenebilir:
  // @Get()
  // getAllTickers(): ProcessedTicker[] {
  //   this.logger.debug('REST request received for all tickers');
  //   return this.cacheUpdateService.getAllTickersFromMemory();
  // }
} 