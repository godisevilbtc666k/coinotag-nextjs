// HyperLiquid /info endpoint (type: metaAndAssetCtxs) yanıtındaki ilk eleman (universe)
export interface HyperLiquidAssetMeta {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated: boolean;
  // ... diğer meta alanları (gerekirse)
}

// HyperLiquid /info endpoint (type: metaAndAssetCtxs) yanıtındaki ikinci eleman (asset contexts)
export interface HyperLiquidAssetCtx {
  dayNtlVlm: string;         // Günlük hacim (notional)
  funding: string;           // Anlık 1 saatlik fonlama oranı (yıllık değil!)
  impactPx: string;          // Etki fiyatı (tahmini)
  markPx: string;            // Mark fiyatı
  midPx: string | null;      // Orta fiyat (likidite yoksa null olabilir)
  openInterest: string;      // Açık pozisyon miktarı (USD cinsinden)
  oraclePx: string;          // Oracle fiyatı
  premium: string | null;    // Premium (oracle vs mark)
  prevDayPx: string;         // Önceki gün fiyatı
  // ... diğer context alanları (gerekirse)
}

// Servisin yayınlayacağı format
export interface HyperLiquidFundingData {
    symbol: string; // Temizlenmiş ve normalize edilmiş sembol
    fundingRate?: number; // Yıllıklandırılmış fonlama oranı
    openInterestValue?: number;
    markPrice?: number; // YENİ: Mark Price eklendi
    lastUpdated?: number; // Verinin çekildiği zaman
} 