// Bybit V5 Tickers Endpoint (/v5/market/tickers?category=linear) yanıtındaki list item'ı
export interface BybitTickerItem {
  symbol: string;
  lastPrice: string;
  indexPrice: string;
  prevPrice24h: string;
  price24hPcnt: string;
  highPrice24h: string;
  lowPrice24h: string;
  prevPrice1h: string;
  openInterest: string;         // Kontrat adedi cinsinden OI
  openInterestValue: string;    // USD cinsinden OI (Bunu kullanacağız)
  turnover24h: string;
  volume24h: string;
  fundingRate: string;          // Anlık fonlama oranı
  nextFundingTime: string;      // Sonraki fonlama zamanı (ms cinsinden string)
  predictedFundingRate?: string; // Tahmini sonraki fonlama oranı (her zaman olmayabilir)
  basisRate?: string;
  deliveryFeeRate?: string;
  deliveryTime?: string;
  ask1Size?: string;
  bid1Price?: string;
  ask1Price?: string;
  bid1Size?: string;
  basis?: string;
}

// Bybit V5 Tickers Endpoint (/v5/market/tickers) genel yanıt yapısı
export interface BybitApiResponse {
  retCode: number;
  retMsg: string;
  result: {
    category: string;
    list: BybitTickerItem[];
  };
  retExtInfo: any; // Veya daha spesifik bir tip
  time: number;
}

// Servisin yayınlayacağı format (sadece FR ve OI)
export interface BybitFundingData {
    symbol: string; // Temizlenmiş sembol
    fundingRate?: number;
    openInterestValue?: number; // USD cinsinden OI
}

// YENİ: Bybit Spot Ticker Stream (v5 public spot) tipi
export interface BybitSpotTickerData {
  symbol: string;     // Örn: BTCUSDT
  lastPrice: string;
  highPrice24h: string;
  lowPrice24h: string;
  prevPrice24h: string; 
  volume24h: string;    // Base asset
  turnover24h: string;  // Quote asset (USDT)
  price24hPcnt: string;
}

export interface BybitSpotTickerEvent {
  topic: string;       
  ts: number;          
  type: string;        
  cs?: number;         
  data: BybitSpotTickerData;
}

// YENİ: Bybit Futures Ticker Stream (v5 public linear) tipi
// Spot ile benzer ama farklı alanlar içerebilir (örn. markPrice, indexPrice)
export interface BybitFuturesTickerData {
  symbol: string;     // Örn: BTCUSDT
  tickDirection: string;
  price24hPcnt: string; // % değişim
  lastPrice: string;    // Son işlem fiyatı
  prevPrice24h: string;
  highPrice24h: string;
  lowPrice24h: string;
  markPrice: string;
  indexPrice: string;
  turnover24h: string;  // Hacim (Quote)
  volume24h: string;    // Hacim (Base)
  fundingRate?: string; // Anlık FR (opsiyonel)
  openInterestValue?: string; // OI (USD, opsiyonel)
  nextFundingTime?: string;
  // ... (Gerekirse diğer alanlar)
}

export interface BybitFuturesTickerEvent {
  topic: string;        // Örn: tickers.BTCUSDT
  type: string;         // snapshot veya delta
  ts: number;           // Timestamp (ms)
  cs?: number;          // Checksum
  data: BybitFuturesTickerData;
}

// --- YENİ TİP ---
export interface BybitTickersResponseResult {
  category: 'spot' | 'linear' | 'inverse' | 'option';
  list: BybitTickerItem[];
  nextPageCursor?: string; // Gerekirse pagination için
}

export interface BybitTickersResponse {
  retCode: number;
  retMsg: string;
  result?: BybitTickersResponseResult;
  retExtInfo?: any;
  time: number;
}
// --- YENİ TİP SONU ---

export interface BybitApiResponse {
  retCode: number;
  retMsg: string;
  result: {
    category: string;
    list: BybitTickerItem[];
  };
  retExtInfo: any; // Veya daha spesifik bir tip
  time: number;
} 