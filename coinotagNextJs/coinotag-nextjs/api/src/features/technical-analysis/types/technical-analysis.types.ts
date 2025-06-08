// K-line (Mum Grafiği) Verisi
export interface Kline {
  openTime: number;
  open: string; // Genellikle string olarak gelir, sayıya çevrilmeli
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
  quoteAssetVolume: string;
  numberOfTrades: number;
  takerBuyBaseAssetVolume: string;
  takerBuyQuoteAssetVolume: string;
  ignore: string;
}

// Hesaplanan İndikatör Sonuçları (Güncellendi)
export interface IndicatorResults {
  rsi?: number;
  macd?: {
    macdLine?: number;
    signalLine?: number;
    histogram?: number;
  };
  sma?: { [period: number]: number }; // Eklendi
  ema?: { [period: number]: number }; // Eklendi
  bollingerBands?: { upper: number; middle: number; lower: number }; // Eklendi
  stochastic?: { k: number; d: number }; // Eklendi
  atr?: number; // Eklendi
  // Eski movingAverages alanı kaldırıldı, sma/ema ile değiştirildi
}

// Pivot Noktaları Sonuçları (Güncellendi - sadece classic)
export interface PivotPointResults {
  classic?: { r3: number; r2: number; r1: number; pp: number; s1: number; s2: number; s3: number };
  // Diğer tipler (fibonacci, camarilla) kaldırıldı veya opsiyonel hale getirildi
}

// Fibonacci Düzeltme Seviyeleri (Güncellendi)
export interface FibonacciLevels {
  level_0: number;    // %0
  level_382?: number; // %38.2 (Opsiyonel, sadece temel seviyeler)
  level_500?: number; // %50 (Opsiyonel)
  level_618?: number; // %61.8 (Opsiyonel)
  level_100: number;  // %100 (level_1000 değil)
  isUptrendCalc: boolean;
  // Diğer seviyeler (11.4, 21.4, 78.6, 88.6) kaldırıldı veya opsiyonel hale getirildi
}

// Trend Analizi Sonucu (Örnek)
export interface TrendAnalysisResult {
    trend: 'Uptrend' | 'Downtrend' | 'Sideways' | 'Uncertain';
    strength?: number; // 0-1 arası trend gücü
    basedOn?: string; // Hangi göstergeye göre (örn: 'MA Cross', 'ADX')
}

// Tüm TA sonuçlarını birleştiren arayüz
export interface TechnicalAnalysisResult {
    symbol: string;
    interval: string;
    klineData?: Kline[]; // Hesaplama için kullanılan mum verisi (opsiyonel)
    indicators?: IndicatorResults;
    pivotPoints?: PivotPointResults;
    fibonacciLevels?: FibonacciLevels;
    trend?: TrendAnalysisResult;
    // Destek/Direnç seviyeleri vb. eklenebilir
} 