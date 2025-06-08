export type AlertCondition = 'above' | 'below';

export type AlertType = 'PRICE' | 'TECHNICAL' | 'NEWS' | 'FUNDING_RATE' | 'OPEN_INTEREST';

export type TechnicalIndicator = 'RSI' | 'MACD' | 'BOLLINGER_BANDS' | 'SUPPORT' | 'RESISTANCE' | 'FIBONACCI';

export type AlertPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';

export type SubscriptionTier = 'FREE' | 'PRO' | 'PRO_PLUS';

export type NotificationMethod = 'PUSH_NOTIFICATION' | 'EMAIL' | 'TELEGRAM' | 'SMS';

export type MarketType = 'spot' | 'futures';

// Ana alarm arayüzü
export interface PriceAlert {
  id: string;
  userId: string;
  symbol: string;
  marketType: MarketType;
  alertType: AlertType;
  
  // Fiyat alarmları için
  targetPrice?: number;
  condition?: AlertCondition;
  
  // Teknik indikatör alarmları için
  technicalIndicator?: TechnicalIndicator;
  technicalValue?: number;
  technicalTimeframe?: string; // '1m', '5m', '15m', '1h', '4h', '1d', '1w'
  
  // Funding rate alarmları için
  fundingRateCondition?: AlertCondition;
  targetFundingRate?: number;
  
  // Open interest alarmları için
  openInterestCondition?: AlertCondition;
  targetOpenInterest?: number;
  
  // Genel ayarlar
  description?: string;
  notificationMethods: NotificationMethod[];
  priority: AlertPriority;
  subscriptionTierRequired: SubscriptionTier;
  
  // Durum bilgileri
  isActive: boolean;
  isPersistent: boolean; // Tetiklendikten sonra aktif kalıp kalmaması
  triggeredCount: number;
  
  // Zaman bilgileri
  createdAt: number;
  lastTriggeredAt?: number;
  triggered: boolean;
  triggeredAt?: number;
  updatedAt?: number;
}

// Alert oluşturma DTO'su
export interface CreateAlertDto {
  symbol: string;
  marketType?: MarketType;
  alertType: AlertType;
  
  // Fiyat alarmları için
  targetPrice?: number;
  condition?: AlertCondition;
  
  // Teknik indikatör alarmları için
  technicalIndicator?: TechnicalIndicator;
  technicalValue?: number;
  technicalTimeframe?: string;
  
  // Funding rate alarmları için
  fundingRateCondition?: AlertCondition;
  targetFundingRate?: number;
  
  // Open interest alarmları için
  openInterestCondition?: AlertCondition;
  targetOpenInterest?: number;
  
  // Genel ayarlar
  description?: string;
  notificationMethods?: NotificationMethod[];
  priority?: AlertPriority;
  isPersistent?: boolean;
}

// Alert güncelleme DTO'su
export interface UpdateAlertDto {
  isActive?: boolean;
  description?: string;
  notificationMethods?: NotificationMethod[];
  priority?: AlertPriority;
  isPersistent?: boolean;
  
  // Fiyat için
  targetPrice?: number;
  condition?: AlertCondition;
  
  // Teknik indikatör için
  technicalValue?: number;
  technicalTimeframe?: string;
  
  // Funding rate için
  targetFundingRate?: number;
  fundingRateCondition?: AlertCondition;
  
  // Open interest için
  targetOpenInterest?: number;
  openInterestCondition?: AlertCondition;
}

// Tier-based restrictions
export const ALERT_TIER_RESTRICTIONS = {
  FREE: {
    maxAlerts: 0,     // 🚫 Hiç alarm yok - Premium'a yönlendir!
    allowedTypes: [] as AlertType[],
    allowedMethods: [] as NotificationMethod[]
  },
  PRO: {
    maxAlerts: 25,    // 💎 PRO: PRICE + FUNDING_RATE
    allowedTypes: ['PRICE', 'FUNDING_RATE'] as AlertType[],
    allowedMethods: ['PUSH_NOTIFICATION', 'EMAIL'] as NotificationMethod[]
  },
  PRO_PLUS: {
    maxAlerts: 100,   // 🔥 PRO+: Tüm özellikler + daha fazla alarm
    allowedTypes: ['PRICE', 'TECHNICAL', 'NEWS', 'FUNDING_RATE', 'OPEN_INTEREST'] as AlertType[],
    allowedMethods: ['PUSH_NOTIFICATION', 'EMAIL', 'TELEGRAM', 'SMS'] as NotificationMethod[]
  }
};

// Alert tetikleme event'i
export interface AlertTriggeredEvent {
  alert: PriceAlert;
  triggerValue: number;
  triggerTime: number;
  marketData?: any;
}

// Notification payload
export interface NotificationPayload {
  userId: string;
  alertId: string;
  title: string;
  message: string;
  priority: AlertPriority;
  methods: NotificationMethod[];
  data?: any;
} 