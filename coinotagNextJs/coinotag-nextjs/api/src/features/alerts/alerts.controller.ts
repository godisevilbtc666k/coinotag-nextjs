import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  Logger,
  UsePipes,
  ValidationPipe,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Res,
} from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { CreateAlertDto, UpdateAlertDto, PriceAlert, AlertType, SubscriptionTier } from './types/alerts.types';
import { DIRECT_REDIS_CLIENT } from '../../redis/redis.constants';
import { RedisClientType } from 'redis';
import { CacheUpdateService } from '../../processing/cache-update/cache-update.service';
import { Inject } from '@nestjs/common';
import { Response } from 'express';

@Controller('alerts')
export class AlertsController {
  private readonly logger = new Logger(AlertsController.name);
  // TODO: Replace with actual user ID from Auth context
  private readonly tempUserId = 'test-user-123';

  constructor(
    private readonly alertsService: AlertsService,
    @Inject(DIRECT_REDIS_CLIENT) private readonly redis: RedisClientType,
    private readonly cacheUpdateService: CacheUpdateService
  ) {}

  // --- Alert Management --- //

  @Post()
  async createAlert(
    @Body() createAlertDto: CreateAlertDto,
    @Query('userId') userId: string, // Geçici - gerçek auth implementasyonuna kadar
  ): Promise<{ success: boolean; alert?: PriceAlert; message?: string }> {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    try {
      this.logger.log(`Creating ${createAlertDto.alertType} alert for user ${userId}, symbol ${createAlertDto.symbol}`);
      
      const alert = await this.alertsService.createAlert(userId, createAlertDto);
      
      return {
        success: true,
        alert,
        message: `${createAlertDto.alertType} alert created successfully`,
      };
    } catch (error) {
      this.logger.error(`Failed to create alert for user ${userId}:`, error);
      
      // Return error details for client handling
      return {
        success: false,
        message: error.message || 'Failed to create alert',
      };
    }
  }

  @Get('user/:userId')
  async getUserAlerts(
    @Param('userId') userId: string,
    @Query('type') alertType?: AlertType,
    @Query('active') active?: string,
  ): Promise<{ success: boolean; alerts: PriceAlert[]; count: number }> {
    try {
      this.logger.debug(`Fetching alerts for user ${userId}, type: ${alertType}, active: ${active}`);
      
      let alerts = await this.alertsService.getAlertsByUser(userId);
      
      // Filter by type if specified
      if (alertType) {
        alerts = alerts.filter(alert => alert.alertType === alertType);
  }

      // Filter by active status if specified
      if (active !== undefined) {
        const isActive = active === 'true';
        alerts = alerts.filter(alert => alert.isActive === isActive);
      }
      
      return {
        success: true,
        alerts,
        count: alerts.length,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch alerts for user ${userId}:`, error);
      return {
        success: false,
        alerts: [],
        count: 0,
      };
    }
  }

  @Get('user/:userId/triggered')
  async getTriggeredAlerts(
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
  ): Promise<{ success: boolean; alerts: PriceAlert[]; count: number }> {
    try {
      this.logger.debug(`Fetching triggered alerts for user ${userId}, limit: ${limit}`);
      
      let alerts = await this.alertsService.getTriggeredAlerts(userId);
      
      // Apply limit if specified
      if (limit) {
        const limitNum = parseInt(limit, 10);
        if (!isNaN(limitNum) && limitNum > 0) {
          alerts = alerts.slice(0, limitNum);
        }
      }
      
      return {
        success: true,
        alerts,
        count: alerts.length,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch triggered alerts for user ${userId}:`, error);
      return {
        success: false,
        alerts: [],
        count: 0,
      };
    }
  }

  @Get('user/:userId/stats')
  async getAlertStats(@Param('userId') userId: string) {
    try {
      const stats = await this.alertsService.getAlertStats(userId);
      const userTier = await this.alertsService.getUserTier(userId);
      
      return {
        success: true,
        stats,
        userTier,
        message: 'Alert statistics retrieved successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to fetch alert stats for user ${userId}:`, error);
      return {
        success: false,
        message: 'Failed to retrieve alert statistics',
      };
    }
  }

  @Get(':alertId')
  async getAlert(@Param('alertId') alertId: string): Promise<{ success: boolean; alert?: PriceAlert; message?: string }> {
    try {
      const alert = await this.alertsService.getAlertById(alertId);
      
      if (!alert) {
        return {
          success: false,
          message: 'Alert not found',
        };
      }
      
      return {
        success: true,
        alert,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch alert ${alertId}:`, error);
      return {
        success: false,
        message: 'Failed to retrieve alert',
      };
    }
  }

  @Patch(':alertId')
  async updateAlert(
    @Param('alertId') alertId: string,
    @Body() updateAlertDto: UpdateAlertDto,
    @Query('userId') userId: string,
  ): Promise<{ success: boolean; alert?: PriceAlert; message?: string }> {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    try {
      this.logger.log(`Updating alert ${alertId} for user ${userId}`);
      
      const alert = await this.alertsService.updateAlert(userId, alertId, updateAlertDto);
      
      return {
        success: true,
        alert,
        message: 'Alert updated successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to update alert ${alertId} for user ${userId}:`, error);
      return {
        success: false,
        message: error.message || 'Failed to update alert',
      };
    }
  }

  @Delete(':alertId')
  async deleteAlert(
    @Param('alertId') alertId: string,
    @Query('userId') userId: string,
  ): Promise<{ success: boolean; message: string }> {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    try {
      this.logger.log(`Deleting alert ${alertId} for user ${userId}`);
      
      const deleted = await this.alertsService.deleteAlert(userId, alertId);
      
      if (deleted) {
        return {
          success: true,
          message: 'Alert deleted successfully',
        };
      } else {
        return {
          success: false,
          message: 'Alert could not be deleted',
        };
      }
    } catch (error) {
      this.logger.error(`Failed to delete alert ${alertId} for user ${userId}:`, error);
      return {
        success: false,
        message: error.message || 'Failed to delete alert',
      };
    }
  }

  // --- User Tier Management --- //

  @Post('user/:userId/tier')
  async setUserTier(
    @Param('userId') userId: string,
    @Body('tier') tier: SubscriptionTier,
  ): Promise<{ success: boolean; message: string }> {
    try {
      this.logger.log(`Setting tier ${tier} for user ${userId}`);
      
      await this.alertsService.setUserTier(userId, tier);
      
      return {
        success: true,
        message: `User tier set to ${tier}`,
      };
    } catch (error) {
      this.logger.error(`Failed to set tier for user ${userId}:`, error);
      return {
        success: false,
        message: 'Failed to set user tier',
      };
    }
  }

  @Get('user/:userId/tier')
  async getUserTier(@Param('userId') userId: string): Promise<{ success: boolean; tier?: SubscriptionTier; message?: string }> {
    try {
      const tier = await this.alertsService.getUserTier(userId);
      
      return {
        success: true,
        tier,
      };
    } catch (error) {
      this.logger.error(`Failed to get tier for user ${userId}:`, error);
      return {
        success: false,
        message: 'Failed to retrieve user tier',
      };
    }
  }

  // --- Alert Types and Restrictions Info --- //

  @Get('meta/types')
  async getAlertTypes(): Promise<{
    success: boolean;
    alertTypes: AlertType[];
    restrictions: Record<SubscriptionTier, any>;
  }> {
    const { ALERT_TIER_RESTRICTIONS } = await import('./types/alerts.types');
    
    return {
      success: true,
      alertTypes: ['PRICE', 'TECHNICAL', 'NEWS', 'FUNDING_RATE', 'OPEN_INTEREST'],
      restrictions: ALERT_TIER_RESTRICTIONS,
    };
  }

  @Get('meta/test')
  async testAlert(@Query('userId') userId: string): Promise<{ success: boolean; message: string }> {
    if (!userId) {
      throw new BadRequestException('User ID is required for testing');
    }

    try {
      // Test price alert creation
      const testAlert: CreateAlertDto = {
        symbol: 'BTC',
        alertType: 'PRICE',
        targetPrice: 100000,
        condition: 'above',
        description: 'Test BTC $100k alert',
      };

      const alert = await this.alertsService.createAlert(userId, testAlert);
      
      return {
        success: true,
        message: `Test alert created with ID: ${alert.id}`,
      };
    } catch (error) {
      this.logger.error(`Test alert creation failed:`, error);
      return {
        success: false,
        message: error.message || 'Test alert creation failed',
      };
    }
  }

  // Test endpoint for debugging
  @Get('debug/btc')
  async debugBTC(): Promise<any> {
    try {
      // Redis'ten BTC alarm bilgilerini çek
      const alertIds = await this.redis.sMembers('alerts:active:BTC');
      const symbolsWithAlerts = await this.redis.keys('alerts:active:*');
      
      // Cache'den BTC ticker'ını çek
      const btcTicker = this.cacheUpdateService.getTickerBySymbolFromMemory('BTC');
      
      // Tüm fiyat alanlarını kontrol et
      const priceAnalysis = btcTicker ? {
        lastPrice: btcTicker.lastPrice,
        binanceSpotPrice: btcTicker.binanceSpotPrice,
        binanceFuturesPrice: btcTicker.binanceFuturesPrice,
        bybitSpotPrice: btcTicker.bybitSpotPrice,
        bybitFuturesPrice: btcTicker.bybitFuturesPrice,
        hyperliquidMarkPrice: btcTicker.hyperliquidMarkPrice,
        // Nested spot/futures data
        nestedSpotBinance: btcTicker.spot?.binance?.lastPrice,
        nestedSpotBybit: btcTicker.spot?.bybit?.lastPrice,
        nestedFuturesBinance: btcTicker.futures?.binance?.lastPrice,
        nestedFuturesBybit: btcTicker.futures?.bybit?.lastPrice,
        nestedFuturesHyperliquid: btcTicker.futures?.hyperliquid?.markPrice,
        // CALCULATED PRICE (same logic as AlertsService)
        calculatedPrice: btcTicker.futures?.binance?.lastPrice ?? 
                        btcTicker.spot?.binance?.lastPrice ?? 
                        btcTicker.futures?.bybit?.lastPrice ??
                        btcTicker.spot?.bybit?.lastPrice ??
                        btcTicker.futures?.hyperliquid?.lastPrice ?? 
                        btcTicker.futures?.hyperliquid?.markPrice,
        // Hangi alanların boş olduğunu tespit et
        emptyFields: Object.entries(btcTicker).filter(([k, v]) => (k.includes('Price') || k === 'lastPrice') && (!v || v === 0)).map(([k]) => k),
        allPriceFields: Object.entries(btcTicker).filter(([k, v]) => k.includes('Price') || k === 'lastPrice').reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {})
      } : null;
      
      return {
        btc_active_alerts: alertIds,
        btc_alert_count: alertIds.length,
        all_symbols_with_alerts: symbolsWithAlerts.map(key => key.replace('alerts:active:', '')),
        btc_ticker_in_cache: !!btcTicker,
        btc_price_analysis: priceAnalysis,
        btc_ticker_summary: btcTicker ? {
          symbol: btcTicker.symbol,
          lastUpdate: btcTicker.lastUpdated,
          sources: {
            binance: !!(btcTicker.binanceSpotPrice || btcTicker.binanceFuturesPrice),
            bybit: !!(btcTicker.bybitSpotPrice || btcTicker.bybitFuturesPrice),
            hyperliquid: !!btcTicker.hyperliquidMarkPrice
          }
        } : null,
        current_time: new Date().toISOString(),
        ticker_cache_status: 'Available'
      };
    } catch (error) {
      return {
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  // Genel sistem durumu için debug endpoint
  @Get('debug/system')
  async debugSystem(): Promise<any> {
    try {
      // Tüm alarm olan symbolları bul
      const symbolsWithAlerts = await this.redis.keys('alerts:active:*');
      const symbols = symbolsWithAlerts.map(key => key.replace('alerts:active:', ''));
      
      const systemStatus = {
        total_symbols_with_alerts: symbols.length,
        symbols_list: symbols,
        symbol_details: {} as any
      };
      
      // Her symbol için durum kontrolü
      for (const symbol of symbols.slice(0, 5)) { // İlk 5 symbol
        const alertCount = await this.redis.sCard(`alerts:active:${symbol}`);
        const ticker = this.cacheUpdateService.getTickerBySymbolFromMemory(symbol);
        
        const currentPrice = ticker ? (ticker.futures?.binance?.lastPrice ?? 
                                       ticker.spot?.binance?.lastPrice ?? 
                                       ticker.futures?.bybit?.lastPrice ??
                                       ticker.spot?.bybit?.lastPrice ??
                                       ticker.futures?.hyperliquid?.lastPrice ?? 
                                       ticker.futures?.hyperliquid?.markPrice) : null;
        
        systemStatus.symbol_details[symbol] = {
          alert_count: alertCount,
          ticker_exists: !!ticker,
          has_price: !!currentPrice,
          calculated_price: currentPrice,
          price_sources: ticker ? {
            nestedSpotBinance: ticker.spot?.binance?.lastPrice,
            nestedSpotBybit: ticker.spot?.bybit?.lastPrice,
            nestedFuturesBinance: ticker.futures?.binance?.lastPrice,
            nestedFuturesBybit: ticker.futures?.bybit?.lastPrice,
            nestedFuturesHyperliquid: ticker.futures?.hyperliquid?.markPrice
          } : null
        };
      }
      
      return {
        ...systemStatus,
        timestamp: new Date().toISOString(),
        performance_mode: 'optimized - only processing symbols with alerts'
      };
    } catch (error) {
      return {
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  @Post('manual-sync')
  async manualSync(@Res() res: Response) {
    try {
      await this.alertsService.syncActiveAlertsToRedis();
      res.json({ success: true, message: 'Manual sync completed' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
} 