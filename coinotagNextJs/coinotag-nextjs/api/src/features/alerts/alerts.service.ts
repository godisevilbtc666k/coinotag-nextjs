import { Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, BadRequestException, ForbiddenException } from '@nestjs/common';
import { RedisClientType } from 'redis';
import { Subscription, filter, map, switchMap } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CacheUpdateService } from '../../processing/cache-update/cache-update.service';
import { ProcessedTicker } from '../../processing/cache-update/cache-update.types';
import { DIRECT_REDIS_CLIENT } from '../../redis/redis.constants';
import { 
  AlertCondition, 
  CreateAlertDto, 
  UpdateAlertDto,
  PriceAlert, 
  AlertType, 
  AlertPriority, 
  SubscriptionTier, 
  NotificationMethod,
  MarketType,
  TechnicalIndicator,
  ALERT_TIER_RESTRICTIONS,
  AlertTriggeredEvent,
  NotificationPayload
} from './types/alerts.types';

@Injectable()
export class AlertsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertsService.name);
  private tickerSubscription: Subscription | null = null;

  // Redis Key Prefixes
  private readonly ALERT_HASH_PREFIX = 'alert:'; // alert:{alertId}
  private readonly USER_ALERTS_SET_PREFIX = 'alerts:user:'; // alerts:user:{userId} -> Set<alertId>
  private readonly SYMBOL_ACTIVE_ALERTS_SET_PREFIX = 'alerts:active:'; // alerts:active:{symbol} -> Set<alertId>
  private readonly USER_TRIGGERED_LIST_PREFIX = 'alerts:triggered:'; // alerts:triggered:{userId} -> List<alertId>
  private readonly USER_ALERT_COUNT_KEY = 'alerts:count:user:'; // alerts:count:user:{userId} -> count

  constructor(
    @Inject(DIRECT_REDIS_CLIENT) private readonly redis: RedisClientType,
    private readonly cacheUpdateService: CacheUpdateService,
    private eventEmitter: EventEmitter2,
  ) {}

  onModuleInit() {
    this.logger.log('🚀 Initializing AlertsService...');
    
    // Wait for initial price data to load before starting alert monitoring
    setTimeout(async () => {
      this.logger.log('🔔 Starting alert monitoring after initial data load...');
      try {
        await this.syncActiveAlertsToRedis();
        this.subscribeToTickerUpdates();
        this.logger.log('✅ ALERT SYSTEM READY - Real-time monitoring active!');
      } catch (error) {
        this.logger.error('Failed to initialize alert system:', error);
        // Retry after additional delay
        setTimeout(() => {
          this.logger.log('🔄 Retrying alert system initialization...');
          this.syncActiveAlertsToRedis().catch(err => 
            this.logger.error('Retry failed:', err)
          );
          this.subscribeToTickerUpdates();
        }, 5000);
      }
    }, 10000); // Wait 10 seconds for WebSocket connections and initial data
  }

  onModuleDestroy() {
    this.logger.log('Unsubscribing from ticker stream.');
    this.tickerSubscription?.unsubscribe();
  }

  private subscribeToTickerUpdates() {
    this.tickerSubscription = this.cacheUpdateService.combinedTickerStream$
      .pipe(
        filter(tickers => tickers && tickers.length > 0),
        switchMap(tickers => this.filterTickersWithAlerts(tickers))
      )
      .subscribe({
        next: (relevantTickers) => {
          if (relevantTickers.length > 0) {
            this.checkAllAlerts(relevantTickers);
          }
        },
        error: (err) => this.logger.error('Error in combined ticker stream for alerts:', err),
      });
  }

  private async filterTickersWithAlerts(allTickers: ProcessedTicker[]): Promise<ProcessedTicker[]> {
    try {
      const symbolsWithAlerts = await this.getSymbolsWithActiveAlerts();
      
      if (symbolsWithAlerts.size === 0) {
        // Sessiz return
        return [];
      }

      const relevantTickers = allTickers.filter(ticker => 
        symbolsWithAlerts.has(ticker.symbol)
      );

      // Debug log kaldırıldı - gereksiz
      // if (relevantTickers.length > 0) {
      //   this.logger.verbose(`Processing ${relevantTickers.length}/${allTickers.length} tickers with active alerts`);
      // }

      return relevantTickers;
    } catch (error) {
      this.logger.error('Error filtering tickers with alerts:', error);
      return [];
    }
  }

  private async getSymbolsWithActiveAlerts(): Promise<Set<string>> {
    try {
      const keys = await this.redis.keys(this.SYMBOL_ACTIVE_ALERTS_SET_PREFIX + '*');
      
      const symbolsWithAlerts = new Set<string>();
      for (const key of keys) {
        const symbol = key.replace(this.SYMBOL_ACTIVE_ALERTS_SET_PREFIX, '');
        if (symbol) {
          const alertCount = await this.redis.sCard(key);
          if (alertCount > 0) {
            symbolsWithAlerts.add(symbol);
          }
        }
      }

      return symbolsWithAlerts;
    } catch (error) {
      this.logger.error('Error getting symbols with active alerts:', error);
      return new Set();
    }
  }

  // --- User Tier Management --- //

  async getUserTier(userId: string): Promise<SubscriptionTier> {
    try {
      // 1. Önce Redis cache'den dene
      const cachedTier = await this.redis.get(`user:tier:${userId}`);
      if (cachedTier) {
        return cachedTier as SubscriptionTier;
      }

      // 2. Supabase'den tier bilgisini al
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      
      if (!supabaseUrl || !supabaseKey) {
        this.logger.warn('Supabase credentials not configured, defaulting to FREE');
        return 'FREE';
      }

      const response = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=subscription_tier`, {
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'apikey': supabaseKey,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Supabase API error: ${response.status}`);
      }

      const profiles = await response.json();
      const userTier = profiles?.[0]?.subscription_tier as SubscriptionTier || 'FREE';

      // 3. Cache'e kaydet (1 saat)
      await this.redis.setEx(`user:tier:${userId}`, 3600, userTier);
      
      return userTier;
    } catch (error) {
      this.logger.warn(`Could not fetch tier for user ${userId}, defaulting to FREE:`, error);
      return 'FREE';
    }
  }

  async setUserTier(userId: string, tier: SubscriptionTier): Promise<void> {
    try {
      // 1. Redis cache'i güncelle
      await this.redis.set(`user:tier:${userId}`, tier);
      
      // 2. Supabase'i de güncelle (paralel olarak)
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      
      if (supabaseUrl && supabaseKey) {
        fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'apikey': supabaseKey,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ subscription_tier: tier })
        }).catch(err => {
          this.logger.error(`Failed to update tier in Supabase (non-blocking):`, err);
        });
      }
    } catch (error) {
      this.logger.error(`Failed to set user tier for ${userId}:`, error);
      throw error;
    }
  }

  // --- Tier-based Validation --- //

  private async validateAlertCreation(userId: string, createDto: CreateAlertDto): Promise<void> {
    const userTier = await this.getUserTier(userId);
    const restrictions = ALERT_TIER_RESTRICTIONS[userTier];
    
    // Check alert type permission
    if (!restrictions.allowedTypes.includes(createDto.alertType)) {
      throw new ForbiddenException(`Alert type ${createDto.alertType} requires ${this.getRequiredTierForAlertType(createDto.alertType)} subscription`);
    }
    
    // Check notification methods
    const requestedMethods = createDto.notificationMethods || ['EMAIL', 'PUSH_NOTIFICATION'];
    const invalidMethods = requestedMethods.filter(method => !restrictions.allowedMethods.includes(method));
    if (invalidMethods.length > 0) {
      throw new ForbiddenException(`Notification methods ${invalidMethods.join(', ')} require higher subscription tier`);
    }
    
    // Check alert count limit
    const currentCount = await this.getUserAlertCount(userId);
    if (currentCount >= restrictions.maxAlerts) {
      throw new ForbiddenException(`Alert limit reached (${restrictions.maxAlerts}). Upgrade your subscription for more alerts.`);
    }
  }

  private getRequiredTierForAlertType(alertType: AlertType): string {
    switch (alertType) {
      case 'PRICE': return 'PRO';        // 💎 Fiyat alarmları PRO gereksin
      case 'FUNDING_RATE': return 'PRO'; // 💎 Funding rate PRO
      case 'OPEN_INTEREST': return 'PRO_PLUS'; // 🔥 OI alarmları PRO+ 
      case 'TECHNICAL': return 'PRO_PLUS';     // 🔥 Teknik analiz PRO+
      case 'NEWS': return 'PRO_PLUS';          // 🔥 Haber alarmları PRO+
      default: return 'PRO_PLUS';
    }
  }

  private async getUserAlertCount(userId: string): Promise<number> {
    const count = await this.redis.get(this.USER_ALERT_COUNT_KEY + userId);
    return parseInt((count as string) || '0', 10);
  }

  private async incrementUserAlertCount(userId: string): Promise<void> {
    await this.redis.incr(this.USER_ALERT_COUNT_KEY + userId);
  }

  private async decrementUserAlertCount(userId: string): Promise<void> {
    const current = await this.getUserAlertCount(userId);
    if (current > 0) {
      await this.redis.decr(this.USER_ALERT_COUNT_KEY + userId);
    }
  }

  // --- Alert Management --- //

  async createAlert(userId: string, createDto: CreateAlertDto): Promise<PriceAlert> {
    // Validate input
    await this.validateAlertInput(createDto);
    
    // Check tier-based permissions
    await this.validateAlertCreation(userId, createDto);
    
    const alertId = uuidv4();
    const now = Date.now();
    const symbolUpper = createDto.symbol.toUpperCase(); 
    const userTier = await this.getUserTier(userId);

    // Ticker check'i geçici olarak skip et - instant alerts için
    const existingTicker = this.cacheUpdateService.getTickerBySymbolFromMemory(symbolUpper);
    if (!existingTicker) {
        this.logger.warn(`Symbol ${symbolUpper} not found in cache, but creating alert anyway for instant response`);
    }

    const newAlert: PriceAlert = {
      id: alertId,
      userId,
      symbol: symbolUpper,
      marketType: createDto.marketType || 'spot',
      alertType: createDto.alertType,
      
      // Fiyat alarmları
      targetPrice: createDto.targetPrice,
      condition: createDto.condition,
      
      // Teknik indikatör alarmları
      technicalIndicator: createDto.technicalIndicator,
      technicalValue: createDto.technicalValue,
      technicalTimeframe: createDto.technicalTimeframe || '1h',
      
      // Funding rate alarmları
      fundingRateCondition: createDto.fundingRateCondition,
      targetFundingRate: createDto.targetFundingRate,
      
      // Open interest alarmları
      openInterestCondition: createDto.openInterestCondition,
      targetOpenInterest: createDto.targetOpenInterest,
      
      // Genel ayarlar
      description: createDto.description,
      notificationMethods: createDto.notificationMethods || ['EMAIL', 'PUSH_NOTIFICATION'],
      priority: createDto.priority || 'NORMAL',
      subscriptionTierRequired: this.getRequiredTierForAlertType(createDto.alertType) as SubscriptionTier,
      
      // Durum bilgileri
      isActive: true,
      isPersistent: createDto.isPersistent || false,
      triggeredCount: 0,
      
      // Zaman bilgileri
      createdAt: now,
      triggered: false,
    };

    this.logger.log(`🚨 CREATING INSTANT ALERT: ${createDto.alertType} for ${userId}, symbol ${symbolUpper}, target: ${createDto.targetPrice}`);

    try {
      // 1. ÖNCELİK: Redis'e ANINDA yaz (performance critical)
      const multi = this.redis.multi();
      
      const alertData: Record<string, string> = {};
      Object.entries(newAlert).forEach(([k, v]) => {
        if (v !== undefined && v !== null) {
          alertData[k] = JSON.stringify(v);
        }
      });
      multi.hSet(this.ALERT_HASH_PREFIX + alertId, alertData);
      multi.sAdd(this.USER_ALERTS_SET_PREFIX + userId, alertId);
      multi.sAdd(this.SYMBOL_ACTIVE_ALERTS_SET_PREFIX + symbolUpper, alertId);
      multi.incr(this.USER_ALERT_COUNT_KEY + userId);

      await multi.exec();
      
      // 2. PARALEL: Supabase'e de yaz (persistence için)
      this.saveAlertToSupabase(newAlert).catch(err => {
        this.logger.error(`Failed to save alert to Supabase (non-blocking):`, err);
      });
      
      // 3. ANINDA KONTROL: Mevcut fiyatla kıyasla, tetiklenebilir mi?
      const currentTicker = this.cacheUpdateService.getTickerBySymbolFromMemory(symbolUpper);
      if (currentTicker && createDto.alertType === 'PRICE') {
        const currentPrice = currentTicker.lastPrice ?? 
                           currentTicker.binanceSpotPrice ?? 
                           currentTicker.binanceFuturesPrice ??
                           currentTicker.bybitSpotPrice ??
                           currentTicker.bybitFuturesPrice ??
                           currentTicker.hyperliquidMarkPrice ?? 
                           currentTicker.hyperliquidLastTradePrice;
        
        if (currentPrice && createDto.targetPrice && createDto.condition) {
          const shouldTrigger = (createDto.condition === 'above' && currentPrice >= createDto.targetPrice) ||
                              (createDto.condition === 'below' && currentPrice <= createDto.targetPrice);
          
          if (shouldTrigger) {
            this.logger.log(`🔥 INSTANT TRIGGER: Alert ${alertId} triggered immediately! Current: ${currentPrice}, Target: ${createDto.targetPrice}`);
            // ANINDA tetikle (non-blocking)
            setImmediate(() => {
              this.triggerAlert(newAlert, currentTicker).catch(err => {
                this.logger.error(`Instant trigger failed:`, err);
              });
            });
          }
        }
      }
      
      this.logger.log(`✅ INSTANT ALERT READY: ${alertId} for ${symbolUpper} - monitoring started!`);
      return newAlert;
    } catch (error) {
      this.logger.error(`Failed to create instant alert for user ${userId}:`, error);
      throw new Error('Could not create alert.');
    }
  }

  // YENİ: Supabase'de alert'i güncelle (trigger durumu sync)
  private async updateAlertInSupabase(alert: PriceAlert): Promise<void> {
    try {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      
      if (!supabaseUrl || !supabaseKey) {
        this.logger.warn('Supabase credentials not configured for alert update');
        return;
      }

      const updateData = {
        triggered: alert.triggered,
        triggered_at: alert.triggeredAt ? new Date(alert.triggeredAt).toISOString() : null,
        triggered_count: alert.triggeredCount,
        is_active: alert.isActive,
        updated_at: new Date().toISOString()
      };

      const response = await fetch(`${supabaseUrl}/rest/v1/alerts?id=eq.${alert.id}`, {
        method: 'PATCH',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(updateData)
      });

      if (response.ok) {
        this.logger.debug(`✅ Alert ${alert.id} updated in Supabase: triggered=${alert.triggered}`);
      } else {
        const errorText = await response.text();
        this.logger.warn(`Failed to update alert in Supabase: ${response.status} ${errorText}`);
      }
    } catch (error) {
      this.logger.warn(`Supabase alert update error (non-blocking):`, error);
    }
  }

  // YENİ: Supabase'e paralel kayıt (non-blocking)
  private async saveAlertToSupabase(alert: PriceAlert): Promise<void> {
    try {
      const supabaseAlert = {
        id: alert.id,
        user_id: alert.userId,
        symbol: alert.symbol,
        market_type: alert.marketType,
        alert_type: alert.alertType,
        
        // Fiyat alarmları için
        condition_operator: alert.condition,
        condition_value: alert.targetPrice?.toString(),
        
        // Teknik indikatör alarmları için
        technical_indicator: alert.technicalIndicator,
        technical_value: alert.technicalValue?.toString(),
        technical_timeframe: alert.technicalTimeframe,
        
        // Funding rate alarmları için
        funding_rate_condition: alert.fundingRateCondition,
        target_funding_rate: alert.targetFundingRate?.toString(),
        
        // Open interest alarmları için
        open_interest_condition: alert.openInterestCondition,
        target_open_interest: alert.targetOpenInterest?.toString(),
        
        // Genel ayarlar
        description: alert.description,
        notification_methods: JSON.stringify(alert.notificationMethods),
        priority: alert.priority,
        
        // Durum bilgileri
        is_active: alert.isActive,
        is_persistent: alert.isPersistent,
        triggered_count: alert.triggeredCount,
        triggered: alert.triggered,
        
        // Zaman bilgileri
        created_at: new Date(alert.createdAt).toISOString(),
        triggered_at: alert.triggeredAt ? new Date(alert.triggeredAt).toISOString() : null
      };

      const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/alerts`, {
        method: 'POST',
        headers: {
          'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(supabaseAlert)
      });

      if (response.ok) {
        this.logger.debug(`✅ Alert ${alert.id} saved to Supabase`);
      } else {
        const errorText = await response.text();
        this.logger.warn(`Failed to save alert to Supabase: ${response.status} ${errorText}`);
      }
    } catch (error) {
      this.logger.warn(`Supabase save error (non-blocking):`, error);
    }
  }

  private async validateAlertInput(createDto: CreateAlertDto): Promise<void> {
    // Genel validasyon
    if (!createDto.symbol || createDto.symbol.trim() === '') {
      throw new BadRequestException('Symbol is required');
    }

    // Alert tipine göre validasyon
    switch (createDto.alertType) {
      case 'PRICE':
        if (!createDto.targetPrice || !createDto.condition) {
          throw new BadRequestException('Target price and condition are required for price alerts');
        }
        if (createDto.targetPrice <= 0) {
          throw new BadRequestException('Target price must be greater than 0');
        }
        break;
        
      case 'TECHNICAL':
        if (!createDto.technicalIndicator || createDto.technicalValue === undefined) {
          throw new BadRequestException('Technical indicator and value are required for technical alerts');
        }
        break;
        
      case 'FUNDING_RATE':
        if (!createDto.fundingRateCondition || createDto.targetFundingRate === undefined) {
          throw new BadRequestException('Funding rate condition and target value are required');
        }
        break;
        
      case 'OPEN_INTEREST':
        if (!createDto.openInterestCondition || createDto.targetOpenInterest === undefined) {
          throw new BadRequestException('Open interest condition and target value are required');
        }
        if (createDto.targetOpenInterest < 0) {
          throw new BadRequestException('Target open interest must be non-negative');
        }
        break;
    }
  }

  async getAlertById(alertId: string): Promise<PriceAlert | null> {
      const alertData = await this.redis.hGetAll(this.ALERT_HASH_PREFIX + alertId);
      if (!alertData || Object.keys(alertData).length === 0) {
          return null;
      }
    
      const parsedAlert: any = {};
      for (const key in alertData) {
          try {
              parsedAlert[key] = JSON.parse(alertData[key]);
      } catch {
              parsedAlert[key] = alertData[key];
          }
      }
      return parsedAlert as PriceAlert;
  }

  async getAlertsByUser(userId: string): Promise<PriceAlert[]> {
    this.logger.debug(`Fetching alerts for user ${userId}`);
    try {
      const alertIds = await this.redis.sMembers(this.USER_ALERTS_SET_PREFIX + userId);
      if (!alertIds || alertIds.length === 0) {
        return [];
      }

      const alerts: PriceAlert[] = [];
      for (const alertId of alertIds) {
         const alert = await this.getAlertById(alertId);
        if (alert) alerts.push(alert);
      }
      return alerts.sort((a, b) => b.createdAt - a.createdAt);
    } catch (error) {
      this.logger.error(`Failed to fetch alerts for user ${userId}:`, error);
      return [];
    }
  }

  async updateAlert(userId: string, alertId: string, updateDto: UpdateAlertDto): Promise<PriceAlert> {
    const alert = await this.getAlertById(alertId);
    if (!alert) {
      throw new NotFoundException(`Alert with ID ${alertId} not found.`);
    }
    if (alert.userId !== userId) {
      throw new NotFoundException(`Alert with ID ${alertId} not found or permission denied.`);
    }

    // Update alert object
    const updatedAlert: PriceAlert = {
      ...alert,
      ...updateDto,
      updatedAt: Date.now(), // Add updated timestamp
    };

    try {
      // Save updated alert to Redis - undefined değerleri filtrele
      const updatedData: Record<string, string> = {};
      Object.entries(updatedAlert).forEach(([k, v]) => {
        if (v !== undefined && v !== null) {
          updatedData[k] = JSON.stringify(v);
        }
      });
      await this.redis.hSet(this.ALERT_HASH_PREFIX + alertId, updatedData);

      this.logger.log(`Alert ${alertId} updated successfully for user ${userId}.`);
      return updatedAlert;
    } catch (error) {
      this.logger.error(`Failed to update alert ${alertId} for user ${userId}:`, error);
      throw new Error('Could not update alert.');
    }
  }

  async deleteAlert(userId: string, alertId: string): Promise<boolean> {
    this.logger.log(`Attempting to delete alert ${alertId} for user ${userId}`);
    
    const alert = await this.getAlertById(alertId);
    if (!alert) {
      throw new NotFoundException(`Alert with ID ${alertId} not found.`);
    }
    if (alert.userId !== userId) {
      throw new NotFoundException(`Alert with ID ${alertId} not found or permission denied.`);
    }

    try {
      const multi = this.redis.multi();
      
      // 1. Ana alert hash'ini sil
      multi.del(this.ALERT_HASH_PREFIX + alertId);
      
      // 2. Kullanıcının alarmları setinden çıkar
      multi.sRem(this.USER_ALERTS_SET_PREFIX + userId, alertId);
      
      // 3. Sembolün aktif alarmları setinden çıkar
      multi.sRem(this.SYMBOL_ACTIVE_ALERTS_SET_PREFIX + alert.symbol, alertId);
      
      // 4. Tetiklenmiş listesinden çıkar
      multi.lRem(this.USER_TRIGGERED_LIST_PREFIX + userId, 0, alertId);
      
      // 5. Kullanıcı alarm sayısını azalt
      multi.decr(this.USER_ALERT_COUNT_KEY + userId);

      const results = await multi.exec();
      const deleted = (results?.[0] as any)?.[1] === 1;
      
      if (deleted) {
          this.logger.log(`Alert ${alertId} deleted successfully for user ${userId}.`);
      } else {
        this.logger.warn(`Alert ${alertId} might not have been fully deleted`);
      }
      return deleted;
    } catch (error) {
      this.logger.error(`Failed to delete alert ${alertId} for user ${userId}:`, error);
      throw new Error('Could not delete alert.');
    }
  }

  async getTriggeredAlerts(userId: string): Promise<PriceAlert[]> {
    this.logger.debug(`Fetching triggered alerts for user ${userId}`);
    try {
      const triggeredIds = await this.redis.lRange(this.USER_TRIGGERED_LIST_PREFIX + userId, 0, -1);
      if (!triggeredIds || triggeredIds.length === 0) {
        return [];
      }

      const alerts: PriceAlert[] = [];
      for (const alertId of triggeredIds) {
        const alert = await this.getAlertById(alertId);
        if (alert && alert.triggered) {
           alerts.push(alert);
        }
      }
      return alerts;
    } catch (error) {
      this.logger.error(`Failed to fetch triggered alerts for user ${userId}:`, error);
      return [];
    }
  }

  // --- Alert Checking --- //

  private async checkAllAlerts(latestTickers: ProcessedTicker[]) {
    // Sessiz processing - sadece error durumunda log
    // if (latestTickers.length > 0) {
    //   this.logger.debug(`🎯 Checking alerts for ${latestTickers.length} tickers`);
    // }
    
    const promises = latestTickers.map(ticker => this.checkAlertsForSymbol(ticker));
    await Promise.allSettled(promises);
  }

  private async checkAlertsForSymbol(ticker: ProcessedTicker) {
    try {
      const symbol = ticker.symbol;
      const alertIds = await this.redis.sMembers(this.SYMBOL_ACTIVE_ALERTS_SET_PREFIX + symbol);
      
      if (!alertIds || alertIds.length === 0) {
        return; // Sessiz, log yok
      }

      // Sadece alert sayısı, fiyat detayı yok
      // this.logger.debug(`🔔 CHECKING ${alertIds.length} alerts for ${symbol} at price $${currentPrice}`);
      
      const alertPromises = alertIds.map(alertId => this.checkSingleAlert(alertId, ticker));
      await Promise.allSettled(alertPromises);
      
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        this.logger.error(`Symbol alert check error (${ticker.symbol}):`, error);
      }
    }
  }

  private async checkSingleAlert(alertId: string, ticker: ProcessedTicker) {
    try {
      const alert = await this.getAlertById(alertId);
      if (!alert || !alert.isActive) {
        return; // Sessiz, log yok
      }
      
      // Sadece değerlendirme detayları için log, her alert için değil
      // this.logger.debug(`🔔 EVAL: Alert ${alertId} - ${alert.alertType} ${alert.condition || alert.alertType} ${alert.targetPrice} for ${ticker.symbol}`);
      
      const shouldTrigger = await this.evaluateAlertCondition(alert, ticker);
      
      if (shouldTrigger) {
        this.logger.log(`🚨 TRIGGERING: Alert ${alertId} for ${ticker.symbol} at ${ticker.lastPrice}`);
        this.triggerAlert(alert, ticker).catch(err => {
          if (process.env.NODE_ENV !== 'production') {
            this.logger.error(`Alert trigger error (${alertId}):`, err);
          }
        });
      }
      // "NOT TRIGGERED" log'u tamamen kaldırıldı
      
    } catch (error) {
      this.logger.error(`🔔 ERROR checking alert ${alertId}:`, error);
    }
  }

  private async evaluateAlertCondition(alert: PriceAlert, ticker: ProcessedTicker): Promise<boolean> {
    switch (alert.alertType) {
      case 'PRICE':
        return this.evaluatePriceCondition(alert, ticker);
      case 'FUNDING_RATE':
        return this.evaluateFundingRateCondition(alert, ticker);
      case 'OPEN_INTEREST':
        return this.evaluateOpenInterestCondition(alert, ticker);
      case 'TECHNICAL':
        // Technical indicators would require additional data processing
        return this.evaluateTechnicalCondition(alert, ticker);
      default:
        return false;
    }
  }

  private evaluatePriceCondition(alert: PriceAlert, ticker: ProcessedTicker): boolean {
    if (!alert.targetPrice) {
      return false; // Sessiz fail
    }
    
    // 🔧 BACKWARD COMPATIBILITY: Eski frontend alarmları için condition convert et
    let condition = alert.condition;
    if (!condition && alert.alertType) {
      const alertTypeStr = alert.alertType as string;
      if (alertTypeStr === 'PRICE_ABOVE') condition = 'above';
      else if (alertTypeStr === 'PRICE_BELOW') condition = 'below';
      else if (alertTypeStr.includes('ABOVE')) condition = 'above';
      else if (alertTypeStr.includes('BELOW')) condition = 'below';
    }
    
    // 🔥 CRITICAL FIX: condition field'ı da "PRICE_ABOVE" olabilir
    if ((condition as string) === 'PRICE_ABOVE') condition = 'above';
    if ((condition as string) === 'PRICE_BELOW') condition = 'below';
    
    if (!condition) {
      return false; // Sessiz fail
    }
    
    // 🔧 FIXED: Use FLAT ticker structure (not nested)
    const currentPrice = ticker.lastPrice ?? 
                        ticker.binanceSpotPrice ?? 
                        ticker.binanceFuturesPrice ??
                        ticker.bybitSpotPrice ??
                        ticker.bybitFuturesPrice ??
                        ticker.hyperliquidMarkPrice ?? 
                        ticker.hyperliquidLastTradePrice;
    
    if (!currentPrice) {
      this.logger.error(`🔔 PRICE EVAL FAIL: No current price for ${ticker.symbol}.`);
      return false;
    }
    
    const result = condition === 'above' ? 
      currentPrice >= alert.targetPrice : 
      currentPrice <= alert.targetPrice;
      
    // Debug log kaldırıldı - sadece result döndür
    return result;
  }

  private evaluateFundingRateCondition(alert: PriceAlert, ticker: ProcessedTicker): boolean {
    if (!alert.targetFundingRate || !alert.fundingRateCondition) return false;
    
    // Try different funding rate sources
    const currentFR = ticker.binanceFundingRate || ticker.bybitFundingRate || ticker.hyperliquidFundingRate;
    if (!currentFR) return false;
    
    if (alert.fundingRateCondition === 'above') {
      return currentFR >= alert.targetFundingRate;
    } else {
      return currentFR <= alert.targetFundingRate;
    }
  }

  private evaluateOpenInterestCondition(alert: PriceAlert, ticker: ProcessedTicker): boolean {
    if (!alert.targetOpenInterest || !alert.openInterestCondition) return false;
    
    // Try different open interest sources
    const currentOI = ticker.binanceOpenInterestValue || ticker.bybitOpenInterestValue || ticker.hyperliquidOpenInterestValue;
    if (!currentOI) return false;
    
    if (alert.openInterestCondition === 'above') {
      return currentOI >= alert.targetOpenInterest;
    } else {
      return currentOI <= alert.targetOpenInterest;
         }
  }

  private async evaluateTechnicalCondition(alert: PriceAlert, ticker: ProcessedTicker): Promise<boolean> {
    // Technical indicator evaluation would require historical data and calculations
    // This is a placeholder implementation
    this.logger.debug(`Technical indicator evaluation not yet implemented for ${alert.technicalIndicator}`);
    return false;
  }

  private async triggerAlert(alert: PriceAlert, ticker: ProcessedTicker): Promise<void> {
    const now = Date.now();
    
    try {
      // PERFORMANS: Redis update'i batch olarak yap
      const updatedAlert: PriceAlert = {
        ...alert,
        triggered: true,
        triggeredAt: now,
        lastTriggeredAt: now,
        triggeredCount: alert.triggeredCount + 1,
        isActive: alert.isPersistent,
      };

      // PERFORMANS: Redis operations batch'te
      const multi = this.redis.multi();
      const triggerData: Record<string, string> = {};
      Object.entries(updatedAlert).forEach(([k, v]) => {
        if (v !== undefined && v !== null) {
          triggerData[k] = JSON.stringify(v);
        }
      });
      multi.hSet(this.ALERT_HASH_PREFIX + alert.id, triggerData);
      multi.lPush(this.USER_TRIGGERED_LIST_PREFIX + alert.userId, alert.id);
      
      if (!alert.isPersistent) {
        multi.sRem(this.SYMBOL_ACTIVE_ALERTS_SET_PREFIX + alert.symbol, alert.id);
      }

      await multi.exec();

      // 🔥 SUPABASE UPDATE: Triggered durumunu sync et
      this.updateAlertInSupabase(updatedAlert).catch(err => {
        this.logger.error(`Failed to update alert in Supabase (non-blocking):`, err);
      });

      // PERFORMANS: Event emission instant
      const triggerEvent = {
        alert: updatedAlert,
        triggerValue: this.getTriggerValue(alert, ticker),
        triggerTime: now,
        marketData: ticker,
      };

      // INSTANT: Immediate event emission
      setImmediate(() => {
        this.eventEmitter.emit('alert.triggered', triggerEvent);
      });

      // INSTANT: Email notification (non-blocking)
      this.sendEmailNotification(updatedAlert, ticker).catch(err => {
        if (process.env.NODE_ENV !== 'production') {
          this.logger.error(`Email notification failed for alert ${alert.id}:`, err);
        }
      });
      
      // PERFORMANS: Enhanced debug logging
      this.logger.log(`🚨 ALERT TRIGGERED: ${alert.symbol} ${alert.condition} ${alert.targetPrice} - Current: ${this.getTriggerValue(alert, ticker)}`);
      this.logger.debug(`Alert ID: ${alert.id}, User: ${alert.userId}, MarketType: ${alert.marketType}`);
    } catch (error) {
      // KRITIK: Sadece önemli hatalar
      this.logger.error(`Critical: Alert trigger failed ${alert.id}:`, error);
    }
  }

  private getTriggerValue(alert: PriceAlert, ticker: ProcessedTicker): number {
    switch (alert.alertType) {
      case 'PRICE':
        return ticker.lastPrice ?? 
               ticker.binanceSpotPrice ?? 
               ticker.binanceFuturesPrice ??
               ticker.bybitSpotPrice ??
               ticker.bybitFuturesPrice ??
               ticker.hyperliquidMarkPrice ?? 
               ticker.hyperliquidLastTradePrice ?? 0;
      case 'FUNDING_RATE':
        return (ticker as any).fundingRate || 0;
      case 'OPEN_INTEREST':
        return (ticker as any).openInterest || 0;
      default:
        return ticker.lastPrice || 0;
    }
  }

  // --- Utility Methods --- //

  async getAlertStats(userId: string): Promise<{
    total: number;
    active: number;
    triggered: number;
    byType: Record<AlertType, number>;
  }> {
    const alerts = await this.getAlertsByUser(userId);
    
    const stats = {
      total: alerts.length,
      active: alerts.filter(a => a.isActive).length,
      triggered: alerts.filter(a => a.triggered).length,
      byType: {
        PRICE: 0,
        TECHNICAL: 0,
        NEWS: 0,
        FUNDING_RATE: 0,
        OPEN_INTEREST: 0,
      } as Record<AlertType, number>,
    };

    alerts.forEach(alert => {
      stats.byType[alert.alertType]++;
    });

    return stats;
  }

  // Email notification method - Supabase SMTP Integration
  private async sendEmailNotification(alert: PriceAlert, ticker: ProcessedTicker): Promise<void> {
    this.logger.debug(`🔔 EMAIL NOTIFICATION: Starting for alert ${alert.id}, methods: ${JSON.stringify(alert.notificationMethods)}`);
    
    // 🔧 CRITICAL FIX: notification methods may be string or array
    let methods: string[] = [];
    if (Array.isArray(alert.notificationMethods)) {
      methods = alert.notificationMethods;
    } else if (typeof alert.notificationMethods === 'string') {
      try {
        methods = JSON.parse(alert.notificationMethods);
      } catch {
        methods = [alert.notificationMethods];
      }
    }
    
    this.logger.debug(`🔔 EMAIL NOTIFICATION: Parsed methods: ${JSON.stringify(methods)}`);
    
    if (!methods.includes('EMAIL')) {
      this.logger.debug(`🔔 EMAIL NOTIFICATION: Skipped - EMAIL not in parsed methods: ${JSON.stringify(methods)}`);
      return;
    }
    
    try {
      // Get user email from Redis cache or database
      this.logger.debug(`🔔 EMAIL NOTIFICATION: Getting user email for ${alert.userId}`);
      const userEmail = await this.getUserEmail(alert.userId);
      if (!userEmail) {
        this.logger.warn(`🔔 EMAIL NOTIFICATION: No email found for user ${alert.userId}`);
        return;
      }
      this.logger.debug(`🔔 EMAIL NOTIFICATION: Found user email: ${userEmail}`);

      const currentPrice = ticker.lastPrice ?? 
                          ticker.binanceSpotPrice ?? 
                          ticker.binanceFuturesPrice ??
                          ticker.bybitSpotPrice ??
                          ticker.bybitFuturesPrice ??
                          ticker.hyperliquidMarkPrice ?? 
                          ticker.hyperliquidLastTradePrice ?? 0;

      const emailData = {
        userEmail,
        symbol: alert.symbol,
        marketType: alert.marketType || 'spot',
        alertType: alert.alertType,
        currentPrice,
        targetPrice: alert.targetPrice,
        condition: alert.condition,
        timestamp: new Date(alert.triggeredAt || Date.now())
      };

      // SUPABASE EDGE FUNCTION: Doğru e-posta gönderimi
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
      
      if (!supabaseUrl || !supabaseAnonKey) {
        this.logger.warn('🔔 EMAIL NOTIFICATION: Supabase credentials not configured for email');
        return;
      }

      this.logger.debug(`🔔 EMAIL NOTIFICATION: Sending via Supabase Edge Function...`);
      const response = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
          method: 'POST',
          headers: {
          'Authorization': `Bearer ${supabaseAnonKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            to: userEmail,
            subject: `🚨 ${alert.symbol} Alarmınız Tetiklendi!`,
            html: this.createEmailTemplate(emailData),
          from: 'noreply@coinotag.com'
          })
        });

      if (response.ok) {
        this.logger.log(`✅ EMAIL NOTIFICATION: Sent successfully for ${alert.symbol} alert to ${userEmail}`);
        } else {
        const errorText = await response.text();
        this.logger.error(`🔔 EMAIL NOTIFICATION: Edge Function failed: ${response.status} ${errorText}`);
      }

    } catch (error) {
      // Silent fail - email problems shouldn't break alerts
      this.logger.error(`🔔 EMAIL NOTIFICATION: Critical error for user ${alert.userId}:`, error);
    }
  }

  private async getUserEmail(userId: string): Promise<string | null> {
    try {
      // CACHE: Redis'ten user email cache'i
      this.logger.debug(`📧 Getting email for user ${userId} - checking cache...`);
      const cachedEmail = await this.redis.get(`user:email:${userId}`);
      if (cachedEmail && typeof cachedEmail === 'string') {
        this.logger.debug(`📧 Found cached email for user ${userId}: ${cachedEmail}`);
        return cachedEmail;
      }
      
      // SUPABASE: Database'den user email çek
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Service role key for server-side
      
      if (!supabaseUrl || !supabaseKey) {
        this.logger.error('📧 Supabase credentials not configured for user email fetch');
        return null;
      }

      this.logger.debug(`📧 Fetching email from Supabase Auth API for user ${userId}...`);
      const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'apikey': supabaseKey,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`📧 Supabase Auth API error: ${response.status} ${errorText}`);
        throw new Error(`Supabase API error: ${response.status}`);
      }

      const user = await response.json();
      const userEmail = user?.email;
      this.logger.debug(`📧 Supabase Auth API response for user ${userId}:`, { email: userEmail, hasEmail: !!userEmail });

      if (userEmail) {
        // CACHE: 24 saat cache'le
        await this.redis.setEx(`user:email:${userId}`, 86400, userEmail);
        this.logger.debug(`📧 Cached email for user ${userId}: ${userEmail}`);
        return userEmail;
      }

      this.logger.warn(`📧 No email found for user ${userId} in Supabase Auth`);
      return null;
    } catch (error) {
      this.logger.error(`📧 Failed to fetch user email for ${userId}:`, error);
      return null;
    }
  }

  private createEmailTemplate(data: any): string {
    const direction = data.alertType === 'PRICE_ABOVE' ? '📈' : '📉';
    return `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; background: #f8fafc; border-radius: 8px;">
        <h2 style="color: #1e293b; text-align: center;">${direction} ${data.symbol} Alarmınız Tetiklendi!</h2>
        <div style="background: white; padding: 20px; border-radius: 6px; margin: 15px 0;">
          <p><strong>Sembol:</strong> ${data.symbol} (${data.marketType.toUpperCase()})</p>
          <p><strong>Güncel Fiyat:</strong> $${data.currentPrice.toLocaleString()}</p>
          <p><strong>Hedef:</strong> ${data.condition} $${data.targetPrice?.toLocaleString()}</p>
          <p><strong>Zaman:</strong> ${data.timestamp.toLocaleString('tr-TR')}</p>
        </div>
        <div style="text-align: center; margin: 20px 0;">
          <a href="https://coinotag.com/kripto-paralar/${data.marketType}/${data.symbol.toLowerCase()}" 
             style="background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Detayları Görüntüle
          </a>
        </div>
        <p style="text-align: center; color: #64748b; font-size: 12px;">© 2024 COINOTAG - Bu e-posta otomatik gönderilmiştir.</p>
      </div>
    `;
  }

  // PRODUCTION: Supabase'den aktif alarmları Redis'e sync et
  async syncActiveAlertsToRedis(): Promise<void> {
    this.logger.log('Syncing active alerts from Supabase to Redis...');
    
    try {
      // Supabase REST API ile aktif alarmları çek
      const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/alerts?is_active=eq.true&select=*`, {
        method: 'GET',
        headers: {
          'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Supabase API error: ${response.status} ${response.statusText}`);
      }

      const alerts = await response.json();
      this.logger.log(`Found ${alerts.length} active alerts in Supabase to sync`);

      if (alerts.length === 0) {
        this.logger.log('No active alerts found in Supabase');
        return;
      }

      // Redis Multi transaction ile bulk insert
      const multi = this.redis.multi();
      let syncedCount = 0;

      for (const alert of alerts) {
        try {
          // Supabase formatından Redis formatına çevir
          const redisAlert = this.convertSupabaseToRedisAlert(alert);
          const alertId = redisAlert.id;
          const symbolUpper = redisAlert.symbol.toUpperCase();

          // Alert data'sını hash olarak kaydet - undefined değerleri filtrele
          const alertData: Record<string, string> = {};
          Object.entries(redisAlert).forEach(([k, v]) => {
            if (v !== undefined && v !== null) {
              alertData[k] = JSON.stringify(v);
            }
          });
          multi.hSet(this.ALERT_HASH_PREFIX + alertId, alertData);
          
          // User alerts setine ekle
          multi.sAdd(this.USER_ALERTS_SET_PREFIX + redisAlert.userId, alertId);
          
          // Symbol alerts setine ekle
          multi.sAdd(this.SYMBOL_ACTIVE_ALERTS_SET_PREFIX + symbolUpper, alertId);
          
          syncedCount++;
        } catch (err) {
          this.logger.error(`Failed to prepare alert ${alert.id} for sync:`, err);
        }
      }

      // Tüm Redis işlemlerini execute et
      const results = await multi.exec();
      this.logger.log(`Successfully synced ${syncedCount} alerts from Supabase to Redis`);
      
    } catch (error) {
      this.logger.error('Failed to sync alerts from Supabase to Redis:', error);
    }
  }

    // DEPRECATED: Gereksiz polling kaldırıldı - Artık instant sistem kullanıyoruz!

  private convertSupabaseToRedisAlert(alert: any): PriceAlert {
    // Supabase'den gelen veriyi Redis formatına çevir
    const notificationMethods = Array.isArray(alert.notification_methods) 
      ? alert.notification_methods 
      : (typeof alert.notification_methods === 'string' 
        ? JSON.parse(alert.notification_methods) 
        : ['EMAIL', 'PUSH_NOTIFICATION']);

    return {
      id: alert.id,
      userId: alert.user_id,
      symbol: alert.symbol.toUpperCase(),
      marketType: alert.market_type || 'spot',
      alertType: alert.alert_type,
      
      // Fiyat alarmları için
      targetPrice: alert.condition_value ? parseFloat(alert.condition_value) : undefined,
      condition: alert.condition_operator,
      
      // Teknik indikatör alarmları için
      technicalIndicator: alert.technical_indicator,
      technicalValue: alert.technical_value ? parseFloat(alert.technical_value) : undefined,
      technicalTimeframe: alert.technical_timeframe || '1h',
      
      // Funding rate alarmları için
      fundingRateCondition: alert.funding_rate_condition,
      targetFundingRate: alert.target_funding_rate ? parseFloat(alert.target_funding_rate) : undefined,
      
      // Open interest alarmları için
      openInterestCondition: alert.open_interest_condition,
      targetOpenInterest: alert.target_open_interest ? parseFloat(alert.target_open_interest) : undefined,
      
      // Genel ayarlar
      description: alert.description,
      notificationMethods: notificationMethods,
      priority: alert.priority || 'NORMAL',
      subscriptionTierRequired: this.getRequiredTierForAlertType(alert.alert_type) as SubscriptionTier,
      
      // Durum bilgileri
      isActive: !!alert.is_active,
      isPersistent: !!alert.is_persistent,
      triggeredCount: alert.triggered_count || 0,
      
      // Zaman bilgileri
      createdAt: new Date(alert.created_at).getTime(),
      triggered: !!alert.triggered_at,
      triggeredAt: alert.triggered_at ? new Date(alert.triggered_at).getTime() : undefined,
    };
  }
} 