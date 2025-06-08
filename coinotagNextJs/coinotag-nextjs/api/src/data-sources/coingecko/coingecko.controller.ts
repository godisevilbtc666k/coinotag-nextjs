import { Controller, Get, Param, NotFoundException, Logger } from '@nestjs/common';
import { CoinGeckoService } from './coingecko.service';
import { CoinGeckoCoinDetail } from './coingecko.types';

@Controller('coins') // Endpoint'i /coins olarak ayarlıyoruz
export class CoinGeckoController {
  private readonly logger = new Logger(CoinGeckoController.name);

  constructor(private readonly coinGeckoService: CoinGeckoService) {}

  @Get(':symbol/details')
  async getCoinDetails(
    @Param('symbol') symbol: string,
  ): Promise<CoinGeckoCoinDetail> {
    this.logger.log(`Request received for coin details: ${symbol}`);
    try {
      const details = await this.coinGeckoService.getCoinDetails(symbol);
      if (!details) {
        // Servis null dönerse veya 404 fırlatırsa bu yakalanacak
        this.logger.warn(`Details not found for symbol: ${symbol}`);
        throw new NotFoundException(`Coin details not found for symbol: ${symbol}`);
      }
      return details;
    } catch (error) {
      // Servisten gelen diğer hatalar (örn: API hatası, Redis hatası)
      this.logger.error(`Error fetching details for symbol ${symbol}:`, error);
      // Hatanın türüne göre farklı yanıtlar verilebilir, şimdilik genel hata fırlatalım
      // Veya NotFoundException olarak maskeleyelim?
      if (error instanceof NotFoundException) {
        throw error;
      }
      // Diğer hatalar için 500 Internal Server Error dönecektir.
      throw error;
    }
  }
} 