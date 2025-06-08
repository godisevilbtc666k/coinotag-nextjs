import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(private readonly cacheService: CacheService) {}

  private async evaluateAlert(alert: any): Promise<boolean> {
    try {
      const symbol = alert.symbol;
      
      // Fiyat verisi mevcut mu kontrol et
      const spotData = await this.cacheService.getSpotData(symbol);
      const futuresData = await this.cacheService.getFuturesData(symbol);
      
      if (!spotData && !futuresData) {
        this.logger.error(`🔔 PRICE EVAL FAIL: No current price data available for ${symbol}. Skipping alert evaluation.`);
        return false;
      }

      // En güncel fiyatı al (futures öncelikli)
      const currentPrice = futuresData?.price || spotData?.price;
      
      if (!currentPrice || currentPrice <= 0) {
        this.logger.error(`🔔 PRICE EVAL FAIL: Invalid price ${currentPrice} for ${symbol}. Skipping alert evaluation.`);
        return false;
      }

      // ... existing evaluation logic ...
    } catch (error) {
      this.logger.error(`🔔 Alert evaluation error for ${alert.symbol}:`, error);
      return false;
    }
  }

  // Alert servisi başlangıcında fiyat verilerinin yüklenmesini bekle
  async onModuleInit() {
    // 10 saniye bekle ki WebSocket bağlantıları kurulsun ve initial data yüklensin
    setTimeout(async () => {
      this.logger.log('🔔 Starting alert monitoring after initial data load...');
      await this.loadUserAlerts();
      this.startPeriodicChecks();
    }, 10000);
  }

  private startPeriodicChecks() {
    // Her dakika alarm kontrolü
    setInterval(async () => {
      try {
        await this.checkAllAlerts();
      } catch (error) {
        this.logger.error('🔔 Periodic alert check failed:', error);
      }
    }, 60000); // 1 dakika
  }
} 