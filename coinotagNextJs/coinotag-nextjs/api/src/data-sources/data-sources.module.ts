import { Module } from '@nestjs/common';
import { BinanceModule } from './binance/binance.module';
import { BybitModule } from './bybit/bybit.module';
import { HyperLiquidModule } from './hyperliquid/hyperliquid.module';
import { CoinGeckoModule } from './coingecko/coingecko.module';
import { HttpModule } from '@nestjs/axios'; // Gerekliyse ekle

@Module({
  imports: [
    HttpModule, // Gerekliyse ekle
    BinanceModule,
    BybitModule,
    HyperLiquidModule,
    CoinGeckoModule,
  ],
  // Bu servisleri dışarıya açmak istiyorsak exports'a ekleyebiliriz
  exports: [
    BinanceModule,
    BybitModule,
    HyperLiquidModule,
    CoinGeckoModule,
  ],
})
export class DataSourcesModule {}
