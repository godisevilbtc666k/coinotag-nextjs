import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { BinanceSpotWsService } from './spot/binance-spot-ws.service';
import { BinanceFuturesService } from './futures/binance-futures.service';
// İleride Futures servisi import edilecek: import { BinanceFuturesService } from './futures/binance-futures.service';

@Module({
  imports: [
    ConfigModule, // BinanceSpotWsService ConfigService kullanıyor
    HttpModule,   // BinanceFuturesService HttpService kullanıyor
  ],
  providers: [
    BinanceSpotWsService,
    BinanceFuturesService,
    // BinanceFuturesService, // P1
  ],
  exports: [
    BinanceSpotWsService, // Bu servisi diğer modüllerin kullanabilmesi için export et
    BinanceFuturesService,
    // BinanceFuturesService, // P1
  ],
})
export class BinanceModule {} 