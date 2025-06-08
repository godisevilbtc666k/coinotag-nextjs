import { BinanceDataSource } from '../../data-sources/binance/common/binance.types';

// API genelinde kullanılacak standart ticker formatı

// --- Alt Veri Yapıları --- 
interface BinanceSpotData {
  lastPrice?: number;
  priceChangePercent?: number;
  volume?: number;
  high?: number;
  low?: number;
  lastUpdated?: number;
}

// YENİ: Bybit Spot Veri Yapısı
export interface BybitSpotData {
  lastPrice?: number;
  priceChangePercent?: number;
  volume?: number; // Quote asset volume (turnover)
  high?: number;
  low?: number;
  lastUpdated?: number;
}

export interface BinanceFuturesData {
  lastPrice?: number;
  priceChangePercent?: number;
  volume?: number; // Quote volume
  high?: number;
  low?: number;
  fundingRate?: number;
  openInterest?: number; // USD değeri
  lastUpdatedTicker?: number; // Ticker stream güncelleme zamanı
  lastUpdatedFR?: number; // Funding Rate güncelleme zamanı
  lastUpdatedOI?: number; // Open Interest güncelleme zamanı
}

export interface BybitFuturesData {
  lastPrice?: number;
  priceChangePercent?: number;
  volume?: number; // Quote asset volume (turnover)
  high?: number;
  low?: number;
  fundingRate?: number;
  openInterestValue?: number;
  lastUpdated?: number; // FR/OI REST update time
}

interface HyperLiquidFuturesData {
  fundingRate?: number;
  openInterestValue?: number; // USD değeri
  markPrice?: number; // YENİ: Mid-price'tan gelen mark price
  lastPrice?: number; // Trade'den gelen son işlem fiyatı
  lastUpdated?: number; // Hem REST hem de WS verisi için kullanılabilir
  lastUpdatedTrade?: number; // Sadece WS trade güncelleme zamanı
}

interface CoinGeckoData {
  name?: string;
  image?: string;
  marketCap?: number;
  marketCapRank?: number;
  circulatingSupply?: number;
  totalSupply?: number | null; // CoinGecko null dönebilir
  maxSupply?: number | null;   // CoinGecko null dönebilir
  ath?: number;
  athChangePercentage?: number;
  athDate?: string;
  atl?: number;
  atlChangePercentage?: number;
  atlDate?: string;
  priceChangePercentage24h?: number;
  lastUpdated?: number;
}

// --- Ana ProcessedTicker Arayüzü --- 
export interface ProcessedTicker {
  symbol: string;
  normalizedSymbol: string;
  lastUpdatedOverall: number;

  spot?: {
    binance?: BinanceSpotData;
    bybit?: BybitSpotData; // YENİ: Bybit spot alanı eklendi
  };

  futures?: {
    binance?: BinanceFuturesData; // Doğrudan interface'i kullan
    bybit?: BybitFuturesData;
    hyperliquid?: HyperLiquidFuturesData;
    // Hesaplananlar buraya taşınabilir (opsiyonel)
    // avgFundingRate?: number; 
    // totalOpenInterest?: number;
  };

  coingecko?: CoinGeckoData;

  // YENİ: Orijinal Binance Sembolleri
  binanceOriginalSpotSymbol?: string; 
  binanceOriginalFuturesSymbol?: string;

  lastPrice?: number;
  changePercent?: number;
  volume?: number;
  high?: number;
  low?: number;
  name?: string;
  logoUrl?: string;
  lastUpdated: number;
  marketCap?: number;

  binanceSpotPrice?: number;
  binanceFuturesPrice?: number;
  binanceMarkPrice?: number;
  binanceChangePercent?: number;
  binanceVolume?: number;
  binanceFundingRate?: number;
  binanceOpenInterest?: number;
  binanceOpenInterestValue?: number;

  bybitSpotPrice?: number;
  bybitFuturesPrice?: number;
  bybitChangePercent?: number;
  bybitVolume?: number;
  bybitFundingRate?: number;
  bybitOpenInterest?: number;
  bybitOpenInterestValue?: number;

  hyperliquidMarkPrice?: number;
  hyperliquidLastTradePrice?: number;
  hyperliquidFundingRate?: number;
  hyperliquidOpenInterest?: number;
  hyperliquidOpenInterestValue?: number;
  hyperliquidVolume?: number;

  source: 'binance' | 'bybit' | 'hyperliquid' | 'combined';

  // YENİ: Frontend için URL ve Varlık Durumu
  binanceHasSpot?: boolean;
  binanceHasFutures?: boolean;
  spotPageUrl?: string;
  futuresPageUrl?: string;
}

// --- KALDIRILAN KOD --- 
// Eski, dosya sonundaki interface tanımları kaldırıldı. 