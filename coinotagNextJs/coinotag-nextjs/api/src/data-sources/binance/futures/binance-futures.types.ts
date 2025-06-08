// Binance Futures Mark Price Update (!markPrice@arr@1s)
export interface BinanceFuturesMarkPrice { // Aslında Mark Price/Funding Rate Stream'den geliyor
    e: 'markPriceUpdate'; // Event type
    E: number;          // Event time
    s: string;          // Symbol
    p: string;          // Mark price
    i: string;          // Index price
    P: string;          // Estimated Settle Price, only useful in the last hour before settlement
    r: string;          // Funding rate
    T: number;          // Next funding time
}

// Binance Futures Ticker Update (!ticker@arr) - Funding/OI için kullanılabilir
// Spot Ticker ile aynı yapıya sahip ama farklı alanlar ilgili olabilir (örn: funding rate)
// Spot'taki BinanceRawTicker'ı kullanabiliriz veya ayrı tutabiliriz.
// Şimdilik Spot'takini kullanmayı düşünebiliriz, ancak ayrı tutmak daha temiz olabilir.
export interface BinanceFuturesTicker {
    e: string; // Event type (e.g., "24hrTicker")
    E: number; // Event time
    s: string; // Symbol
    p: string; // Price change
    P: string; // Price change percent
    w: string; // Weighted average price
    c: string; // Last price
    Q: string; // Last quantity
    o: string; // Open price
    h: string; // High price
    l: string; // Low price
    v: string; // Total traded base asset volume
    q: string; // Total traded quote asset volume
    O: number; // Statistics open time
    C: number; // Statistics close time
    F: number; // First trade ID
    L: number; // Last trade ID
    n: number; // Total number of trades
}

// Binance Futures Funding Rate (REST API - /fapi/v1/fundingRate)
export interface BinanceFuturesFundingRate {
    symbol: string;
    fundingTime: number;
    fundingRate: string;
    markPrice?: string;
}

// Binance Futures Open Interest (REST API - /fapi/v1/openInterest)
export interface BinanceFuturesOpenInterest {
    symbol: string;
    openInterest: string;
    time: number; // Timestamp for OI data
}

// Open Interest History (REST API - /futures/data/openInterestHist)
// Bu daha çok grafik içindir, anlık OI için /fapi/v1/openInterest daha uygun
export interface BinanceFuturesOpenInterestHist {
    symbol: string;
    sumOpenInterest: string;
    sumOpenInterestValue: string;
    timestamp: number;
} 