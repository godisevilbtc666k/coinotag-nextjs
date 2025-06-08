import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Subject, Subscription, firstValueFrom, interval } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { HyperLiquidAssetMeta, HyperLiquidAssetCtx, HyperLiquidFundingData } from './hyperliquid.types';
import { AxiosError } from 'axios';
import { WsConnectionStatus } from '../../common/types/connection-status.types';

@Injectable()
export class HyperLiquidService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HyperLiquidService.name);
  private readonly apiUrl = 'https://api.hyperliquid.xyz/info';
  private readonly fetchIntervalMs = 60 * 1000; // 1 dakikada bir çek
  private fetchSubscription: Subscription | null = null;

  // FR ve OI verilerini yayınlamak için Subject
  private fundingDataSubject = new Subject<HyperLiquidFundingData[]>();
  public fundingDataStream$ = this.fundingDataSubject.asObservable();

  // Add Subject for status
  private statusSubject = new Subject<WsConnectionStatus>();
  public statusStream$ = this.statusSubject.asObservable();
  private currentStatus: WsConnectionStatus = 'disconnected'; // Add state variable

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    this.logger.log('Initializing HyperLiquid Service and starting data fetch loop...');
    this.startFetching();
  }

  onModuleDestroy() {
    this.logger.log('Stopping HyperLiquid data fetching.');
    this.stopFetching();
    // Set status to disconnected
    this.updateStatus('disconnected'); 
  }

  private updateStatus(newStatus: WsConnectionStatus) {
    if (this.currentStatus !== newStatus) {
      this.currentStatus = newStatus;
      this.statusSubject.next(newStatus);
      this.logger.log(`HyperLiquid status updated to: ${newStatus}`);
    }
  }

  private startFetching() {
    this.stopFetching();
    this.updateStatus('connecting'); // Set status to connecting when starting
    this.fetchSubscription = interval(this.fetchIntervalMs)
      .pipe(
        switchMap(() => this.fetchData()),
        catchError(error => {
          this.logger.error('Error in HyperLiquid fetch interval:', error);
          return [];
        })
      )
      .subscribe();
    this.fetchData(); // İlk veriyi hemen çek
  }

  private stopFetching() {
    this.fetchSubscription?.unsubscribe();
    this.fetchSubscription = null;
    // Don't set to disconnected here, only on module destroy
  }

  // Sembol normalizasyonu (binanceService.ts'ten alınabilir)
  private normalizeSymbol(symbol: string): string {
      // Hyperliquid "k" prefix meme coin listesi
      if (symbol.startsWith('k') && ['kBONK', 'kPEPE', 'kSHIB', 'kFLOKI', 'kNEIRO', 'kLUNC', 'kDOGS'].includes(symbol)) {
          // 'k' prefixini kaldırıp normal sembol halini döndür
          return symbol.substring(1);
      }
      
      const symbolMap: Record<string, string> = {
          "WBTC": "BTC",
          "WETH": "ETH",
          // Diğer eşleştirmeler eklenebilir
      };
      return symbolMap[symbol] || symbol;
  }

  private async fetchData(): Promise<void> {
    this.logger.verbose('Fetching HyperLiquid data (FR/OI) from REST API...');
    let retryCount = 0;
    const maxRetries = 3;
    const retryDelay = 5000; // 5 saniye
    
    while (retryCount <= maxRetries) {
      try {
        // PERFORMANS: Daha kısa timeout ve DNS fallback
        const response = await firstValueFrom(
          this.httpService.post<[ { universe: HyperLiquidAssetMeta[] }, HyperLiquidAssetCtx[] ]>(
            this.apiUrl,
            { "type": "metaAndAssetCtxs" },
            { 
              timeout: 5000, // 5 saniye timeout (daha kısa)
              headers: {
                'User-Agent': 'Coinotag-API/1.0',
                'Accept': 'application/json',
                'Connection': 'keep-alive'
              }
            }
          )
        );

        if (response.status === 200 && Array.isArray(response.data) && response.data.length >= 2) {
          const universe = response.data[0]?.universe || [];
          const assetCtxs = response.data[1] || [];
          const hyperliquidData: HyperLiquidFundingData[] = [];

          universe.forEach((meta, index) => {
            const ctx = assetCtxs[index];
            if (!meta || !ctx) return;

            const rawSymbol = meta.name;
            const symbol = this.normalizeSymbol(rawSymbol);
            const context = assetCtxs[index];
            const dataToSend: HyperLiquidFundingData = { symbol }; // Initialize with symbol

            const fundingRate = context.funding ? parseFloat(context.funding) : undefined;
            const openInterestValue = context.openInterest ? parseFloat(context.openInterest) : undefined;
            const markPrice = context.markPx ? parseFloat(context.markPx) : undefined; // Mark Price'ı parse et

            if (fundingRate !== undefined && !isNaN(fundingRate)) dataToSend.fundingRate = fundingRate;
            if (openInterestValue !== undefined && !isNaN(openInterestValue)) dataToSend.openInterestValue = openInterestValue;
            if (markPrice !== undefined && !isNaN(markPrice)) dataToSend.markPrice = markPrice; // Mark Price'ı ekle

            if (Object.keys(dataToSend).length > 1) { // symbol haricinde veri varsa
              // ÖZEL LOGLAMA (HYPE için)
              if (rawSymbol === 'HYPE') {
                this.logger.verbose(`[HYPERLIQUID-LOG HYPE CTX RAW]: ${JSON.stringify(context)}`);
                this.logger.verbose(`[HYPERLIQUID-LOG HYPE SENDING]: ${JSON.stringify(dataToSend)}`);
              }
              hyperliquidData.push(dataToSend);
            }
          });

          this.logger.log(`Fetched ${hyperliquidData.length} FR/OI data points from HyperLiquid.`);
          if (hyperliquidData.length > 0) {
             this.fundingDataSubject.next(hyperliquidData);
          }
          // Set status to connected on successful fetch
          this.updateStatus('connected'); 
          return; // Başarılı, çık
        }
      } catch (error) {
        retryCount++;
        const axiosError = error as AxiosError;
        
        if (retryCount <= maxRetries) {
          this.logger.warn(`HyperLiquid fetch failed (attempt ${retryCount}/${maxRetries}): ${axiosError.message}. Retrying in ${retryDelay/1000}s...`);
          // Disconnected durumunda warning, son denemede error
          if (retryCount === maxRetries) {
            this.updateStatus('disconnected');
          }
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        } else {
          this.logger.error(`HyperLiquid fetch failed after ${maxRetries} attempts:`, axiosError.message);
          this.updateStatus('disconnected');
          return;
        }
      }
    }
  }
} 