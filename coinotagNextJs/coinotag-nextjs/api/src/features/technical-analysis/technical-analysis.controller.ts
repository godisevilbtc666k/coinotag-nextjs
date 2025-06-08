import { Controller, Get, Param, Query, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { TechnicalAnalysisService } from './technical-analysis.service';
import { TechnicalAnalysisResult } from './types/technical-analysis.types';

// Controller'da kullanılacak interval tipi (Service'teki ile aynı olmalı)
type KlineInterval = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '8h' | '12h' | '1d' | '3d' | '1w' | '1M';
const validIntervals: Set<string> = new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M']);

@Controller('ta') // Endpoint'i /ta olarak ayarlıyoruz
export class TechnicalAnalysisController {
  private readonly logger = new Logger(TechnicalAnalysisController.name);

  constructor(private readonly taService: TechnicalAnalysisService) {}

  @Get(':symbol/:interval')
  async getAnalysis(
    @Param('symbol') rawSymbol: string, // Örn: BTCUSDT
    @Param('interval') interval: string, // Endpoint'ten gelen string
    @Query('limit') limit?: string, // Opsiyonel query param
  ): Promise<TechnicalAnalysisResult> {
    this.logger.log(`Request received for TA: ${rawSymbol}, Interval: ${interval}, Limit: ${limit}`);

    // Interval validasyonu
    if (!validIntervals.has(interval)) {
        throw new BadRequestException(`Invalid interval: ${interval}. Valid intervals are: ${Array.from(validIntervals).join(', ')}`);
    }

    // Limit validasyonu (opsiyonel)
    let klineLimit = 200; // Varsayılan
    if (limit) {
        const parsedLimit = parseInt(limit, 10);
        if (isNaN(parsedLimit) || parsedLimit <= 0 || parsedLimit > 1000) { // Binance max 1000
            throw new BadRequestException('Invalid limit parameter. Must be a positive integer <= 1000.');
        }
        klineLimit = parsedLimit;
    }

    try {
      // Servisi çağırırken interval'i doğru tiple gönder
      const result = await this.taService.getTechnicalAnalysis(rawSymbol, interval as KlineInterval, klineLimit);
      return result;
    } catch (error) {
      this.logger.error(`Error getting TA for ${rawSymbol} ${interval}:`, error);
      // Servisten gelen NotFoundException veya diğer hataları handle et
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      // Diğer hatalar için genel bir hata fırlat
      throw new Error(`Failed to get technical analysis for ${rawSymbol}`);
    }
  }
} 