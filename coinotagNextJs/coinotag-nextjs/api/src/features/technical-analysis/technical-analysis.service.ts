import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios'; // K-line çekmek için gerekebilir
import { firstValueFrom } from 'rxjs';
import {
  Kline,
  IndicatorResults,
  PivotPointResults,
  FibonacciLevels,
  TrendAnalysisResult,
  TechnicalAnalysisResult,
} from './types/technical-analysis.types';
import { AxiosError } from 'axios';
// technicalindicators kütüphanesinden gerekli fonksiyonları import et
import {
    RSI,
    MACD,
    SMA,
    EMA,
    BollingerBands,
    Stochastic,
    ATR
} from 'technicalindicators';

// Örnek K-line interval'leri (Binance API uyumlu)
type KlineInterval = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '8h' | '12h' | '1d' | '3d' | '1w' | '1M';

@Injectable()
export class TechnicalAnalysisService {
  private readonly logger = new Logger(TechnicalAnalysisService.name);
  private readonly binanceApiBaseUrl = 'https://api.binance.com/api/v3'; // Veya fapi

  constructor(private readonly httpService: HttpService) {}

  // K-line Verisini Çekme (Basit Örnek - Hata Yönetimi ve Optimizasyon Gerekli)
  private async fetchKlineData(
    symbol: string, // Örn: BTCUSDT (Ham sembol, temizlenmemiş)
    interval: KlineInterval,
    limit: number = 100, // Kaç adet mum çubuğu alınacak
  ): Promise<Kline[]> {
    const url = `${this.binanceApiBaseUrl}/klines`;
    this.logger.debug(`Fetching ${limit} klines for ${symbol} interval ${interval}...`);
    try {
      const response = await firstValueFrom(
        this.httpService.get<any[]>(url, {
          params: {
            symbol: symbol.toUpperCase(), // Binance API büyük harf bekler
            interval,
            limit,
          },
          timeout: 10000, // 10 saniye timeout
        }),
      );

      if (response.status === 200 && Array.isArray(response.data)) {
        // Binance API'den gelen dizi formatını Kline arayüzüne map et
        const klines: Kline[] = response.data.map((k: any[]) => ({
          openTime: k[0],
          open: k[1],
          high: k[2],
          low: k[3],
          close: k[4],
          volume: k[5],
          closeTime: k[6],
          quoteAssetVolume: k[7],
          numberOfTrades: k[8],
          takerBuyBaseAssetVolume: k[9],
          takerBuyQuoteAssetVolume: k[10],
          ignore: k[11],
        }));
        this.logger.debug(`Fetched ${klines.length} klines successfully.`);
        return klines;
      } else {
        this.logger.error(`Failed to fetch klines for ${symbol}. Status: ${response.status}`);
        throw new Error(`Failed to fetch klines. Status: ${response.status}`);
      }
    } catch (error) {
      if (error instanceof AxiosError && error.response?.status === 404) {
        this.logger.warn(`Kline data not found for symbol: ${symbol} on Binance.`);
        throw new NotFoundException(`Kline data not found for symbol: ${symbol}`);
      }
      if (error instanceof AxiosError) {
          this.logger.error(`Axios Error fetching klines for ${symbol}: ${error.message}`, error.stack);
      } else {
          this.logger.error(`Error fetching klines for ${symbol}:`, error);
      }
      throw new Error(`Failed to fetch kline data: ${error.message}`);
    }
  }

  // --- Hesaplama Fonksiyonları (technicalindicators ile dolduruldu) ---

  private calculateIndicators(klines: Kline[]): IndicatorResults {
    this.logger.debug('Calculating indicators...');
    const results: IndicatorResults = { sma: {}, ema: {} };
    if (!klines || klines.length < 1) return results; // Yeterli veri yoksa boş dön

    const closePrices = klines.map(k => parseFloat(k.close));
    const highPrices = klines.map(k => parseFloat(k.high));
    const lowPrices = klines.map(k => parseFloat(k.low));

    // RSI (14 periyot)
    const rsiPeriod = 14;
    if (closePrices.length >= rsiPeriod) {
        try {
            const rsiResult = RSI.calculate({ period: rsiPeriod, values: closePrices });
            if (rsiResult.length > 0) results.rsi = parseFloat(rsiResult[rsiResult.length - 1].toFixed(2));
        } catch (e) { this.logger.warn('RSI calculation failed', e); }
    }

    // MACD (12, 26, 9 periyot)
    const macdFast = 12, macdSlow = 26, macdSignal = 9;
    if (closePrices.length >= macdSlow + macdSignal - 1) {
        try {
            const macdInput = {
                values: closePrices, fastPeriod: macdFast, slowPeriod: macdSlow, signalPeriod: macdSignal,
                SimpleMAOscillator: false, SimpleMASignal: false
            };
            const macdResult = MACD.calculate(macdInput);
            if (macdResult.length > 0) {
                const lastMacd = macdResult[macdResult.length - 1];
                if (lastMacd && lastMacd.MACD !== undefined && lastMacd.signal !== undefined && lastMacd.histogram !== undefined) {
                    results.macd = {
                        macdLine: parseFloat(lastMacd.MACD.toFixed(4)),
                        signalLine: parseFloat(lastMacd.signal.toFixed(4)),
                        histogram: parseFloat(lastMacd.histogram.toFixed(4))
                    };
                }
            }
        } catch (e) { this.logger.warn('MACD calculation failed', e); }
    }

    // Moving Averages (EMA 20, SMA 50, SMA 200)
    const maPeriods = [ { type: 'EMA', period: 20 }, { type: 'SMA', period: 50 }, { type: 'SMA', period: 200 } ];
    maPeriods.forEach(ma => {
        if (closePrices.length >= ma.period) {
            try {
                let maResult: number[] = [];
                if (ma.type === 'EMA') maResult = EMA.calculate({ period: ma.period, values: closePrices });
                else if (ma.type === 'SMA') maResult = SMA.calculate({ period: ma.period, values: closePrices });

                if (maResult.length > 0) {
                    const value = parseFloat(maResult[maResult.length - 1].toFixed(4));
                    if (ma.type === 'EMA' && results.ema) results.ema[ma.period] = value;
                    else if (ma.type === 'SMA' && results.sma) results.sma[ma.period] = value;
                }
            } catch (e) { this.logger.warn(`${ma.type}${ma.period} calculation failed`, e); }
        }
    });

    // Bollinger Bands (20 periyot, 2 stdDev)
    const bbPeriod = 20, bbStdDev = 2;
    if (closePrices.length >= bbPeriod) {
        try {
            const bbResult = BollingerBands.calculate({ period: bbPeriod, stdDev: bbStdDev, values: closePrices });
            if (bbResult.length > 0) {
                const lastBB = bbResult[bbResult.length - 1];
                results.bollingerBands = {
                    upper: parseFloat(lastBB.upper.toFixed(4)),
                    middle: parseFloat(lastBB.middle.toFixed(4)),
                    lower: parseFloat(lastBB.lower.toFixed(4))
                };
            }
        } catch (e) { this.logger.warn('Bollinger Bands calculation failed', e); }
    }

    // Stochastic (14, 3, 3 periyot)
    const stochK = 14, stochD = 3, stochSmooth = 3; // D periyodu smooth olarak kullanılır
    if (klines.length >= stochK + stochSmooth -1) {
         try {
             const stochasticInput = { high: highPrices, low: lowPrices, close: closePrices, period: stochK, signalPeriod: stochD };
             const stochasticResult = Stochastic.calculate(stochasticInput);
             if (stochasticResult.length > 0) {
                 const lastStoch = stochasticResult[stochasticResult.length - 1];
                 if (lastStoch && lastStoch.k !== undefined && lastStoch.d !== undefined) {
                    results.stochastic = { k: parseFloat(lastStoch.k.toFixed(2)), d: parseFloat(lastStoch.d.toFixed(2)) };
                 }
             }
         } catch (e) { this.logger.warn('Stochastic calculation failed', e); }
    }

    // ATR (14 periyot)
    const atrPeriod = 14;
    if (klines.length >= atrPeriod + 1) {
         try {
             const atrInput = { high: highPrices, low: lowPrices, close: closePrices, period: atrPeriod };
             const atrResult = ATR.calculate(atrInput);
             if (atrResult.length > 0) {
                 const lastAtr = atrResult[atrResult.length - 1];
                 if (lastAtr !== undefined) results.atr = parseFloat(lastAtr.toFixed(4));
             }
         } catch (e) { this.logger.warn('ATR calculation failed', e); }
    }

    return results;
  }

  // Pivot Points (Klasik) - Hesaplama kütüphaneye bağımlı değil, aynı kalabilir
  private calculatePivotPoints(klines: Kline[]): PivotPointResults {
    this.logger.debug('Calculating classic pivot points...');
    if (!klines || klines.length < 1) return {}; // Veri yoksa boş dön
    try {
        const lastKline = klines[klines.length - 1];
        const high = parseFloat(lastKline.high);
        const low = parseFloat(lastKline.low);
        const close = parseFloat(lastKline.close);
        if (isNaN(high) || isNaN(low) || isNaN(close)) throw new Error('Invalid HLC values');

        const pp = (high + low + close) / 3;
        const r1 = (2 * pp) - low;
        const s1 = (2 * pp) - high;
        const r2 = pp + (high - low);
        const s2 = pp - (high - low);
        const r3 = high + 2 * (pp - low);
        const s3 = low - 2 * (high - pp);

        const classicPivots = { pp, r1, s1, r2, s2, r3, s3 };
        // Hesaplanan değerlerde NaN kontrolü
        if (Object.values(classicPivots).some(isNaN)) throw new Error('NaN detected in pivot results');

        return { classic: classicPivots };
    } catch (e: any) {
        this.logger.warn(`Classic pivot calculation failed: ${e.message}`);
        return {};
    }
  }

  // Fibonacci Retracement (Basit high/low bazlı, tip düzeltmesi ile)
  private calculateFibonacciRetracement(klines: Kline[]): FibonacciLevels | null {
      this.logger.debug('Calculating simple Fibonacci retracement...');
      if (!klines || klines.length < 2) return null;
      try {
          let high = -Infinity, low = Infinity, highIndex = 0, lowIndex = 0;
          klines.forEach((k, index) => {
              const h = parseFloat(k.high); const l = parseFloat(k.low);
              if (h > high) { high = h; highIndex = index; }
              if (l < low) { low = l; lowIndex = index; }
          });
          if (high === low || !isFinite(high) || !isFinite(low)) throw new Error('Invalid high/low');

          const diff = high - low;
          const isUptrendCalc = highIndex > lowIndex;
          let levels: Partial<FibonacciLevels> = {}; // Partial kullanarak başlayalım

          if (isUptrendCalc) {
              levels = {
                  level_100: low, // %100 = Low (Düzeltildi: level_1000 -> level_100)
                  level_618: low + diff * 0.382,
                  level_500: low + diff * 0.5,
                  level_382: low + diff * 0.618,
                  level_0: high, // %0 = High
              };
          } else {
              levels = {
                  level_100: high, // %100 = High (Düzeltildi: level_1000 -> level_100)
                  level_618: high - diff * 0.382,
                  level_500: high - diff * 0.5,
                  level_382: high - diff * 0.618,
                  level_0: low, // %0 = Low
              };
          }

          const fibResult: FibonacciLevels = {
              ...levels,
              level_0: levels.level_0!, // non-null assertion
              level_100: levels.level_100!, // non-null assertion
              isUptrendCalc
          };

          // NaN kontrolü
          if (isNaN(fibResult.level_0) || isNaN(fibResult.level_100) ||
              (fibResult.level_382 !== undefined && isNaN(fibResult.level_382)) ||
              (fibResult.level_500 !== undefined && isNaN(fibResult.level_500)) ||
              (fibResult.level_618 !== undefined && isNaN(fibResult.level_618)) ) {
                  throw new Error('NaN detected in Fibonacci results');
          }

          return fibResult;
      } catch (e: any) {
          this.logger.warn(`Fibonacci calculation failed: ${e.message}`);
          return null;
      }
  }

  // Trend Belirleme (MA Kesişimleri ve MACD bazlı)
  private determineTrend(klines: Kline[], indicators: IndicatorResults): TrendAnalysisResult {
      this.logger.debug('Determining trend...');
      if (!klines || klines.length < 2 || !indicators) return { trend: 'Uncertain' };

      try {
          const lastClose = parseFloat(klines[klines.length - 1].close);
          const prevClose = parseFloat(klines[klines.length - 2].close);
          const ema20 = indicators.ema?.[20];
          const sma50 = indicators.sma?.[50];
          const sma200 = indicators.sma?.[200];
          const macdHist = indicators.macd?.histogram;
          let score = 0;
          let basedOn = [];
          if (sma50 !== undefined && sma200 !== undefined) {
              if (sma50 > sma200) { score += 1; basedOn.push('SMA50>SMA200'); }
              else if (sma50 < sma200) { score -= 1; basedOn.push('SMA50<SMA200'); }
          }
          if (sma50 !== undefined) {
              if (lastClose > sma50) { score += 1; basedOn.push('Close>SMA50'); }
              else if (lastClose < sma50) { score -= 1; basedOn.push('Close<SMA50'); }
          }
          if (ema20 !== undefined && sma50 !== undefined) {
              if (ema20 > sma50) { score += 0.5; basedOn.push('EMA20>SMA50'); }
              else if (ema20 < sma50) { score -= 0.5; basedOn.push('EMA20<SMA50'); }
          }
          if (macdHist !== undefined) {
              if (macdHist > 0) { score += 1; basedOn.push('MACD Hist > 0'); }
              else if (macdHist < 0) { score -= 1; basedOn.push('MACD Hist < 0'); }
          }
          let finalTrend: 'Uptrend' | 'Downtrend' | 'Sideways' | 'Uncertain' = 'Uncertain';
          if (score >= 1.5) finalTrend = 'Uptrend';
          else if (score <= -1.5) finalTrend = 'Downtrend';
          else if (score > -1.5 && score < 1.5) finalTrend = 'Sideways';
          return {
              trend: finalTrend,
              basedOn: basedOn.join(', ') || 'N/A'
          };
      } catch (e: any) {
          this.logger.warn(`Trend determination failed: ${e.message}`);
          return { trend: 'Uncertain' };
      }
  }

  // --- Ana Servis Fonksiyonu ---

  async getTechnicalAnalysis(
    rawSymbol: string, // Örn: BTCUSDT
    interval: KlineInterval = '1h',
    klineLimit: number = 200, // Hesaplamalar için genellikle yeterli
  ): Promise<TechnicalAnalysisResult> {
    this.logger.log(`Performing technical analysis for ${rawSymbol} interval ${interval}...`);

    // 1. K-line verisini çek
    // Not: CacheUpdateService'teki cleanSymbol burada kullanılabilir veya sembol doğrudan iletilebilir.
    // Şimdilik rawSymbol kullanıyoruz.
    const klines = await this.fetchKlineData(rawSymbol, interval, klineLimit);

    if (!klines || klines.length === 0) {
      this.logger.warn(`No kline data fetched for ${rawSymbol}, cannot perform analysis.`);
      throw new NotFoundException(`Could not retrieve kline data for ${rawSymbol} to perform analysis.`);
    }

    // 2. Hesaplamaları yap
    const indicators = this.calculateIndicators(klines);
    const pivotPoints = this.calculatePivotPoints(klines);
    const fibonacciLevels = this.calculateFibonacciRetracement(klines);
    const trend = this.determineTrend(klines, indicators);

    // 3. Sonucu birleştir
    const result: TechnicalAnalysisResult = {
      symbol: rawSymbol, // Veya temizlenmiş sembol?
      interval: interval,
      // klineData: klines, // İstemciye kline göndermek istersek
      indicators,
      pivotPoints,
      fibonacciLevels: fibonacciLevels ?? undefined, // null ise undefined yap
      trend,
    };

    this.logger.log(`Technical analysis completed for ${rawSymbol} interval ${interval}.`);
    return result;
  }
} 