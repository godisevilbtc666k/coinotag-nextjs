import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { BinanceModule } from '../../data-sources/binance/binance.module';
import { BybitModule } from '../../data-sources/bybit/bybit.module';
import { HyperLiquidModule } from '../../data-sources/hyperliquid/hyperliquid.module';
import { CoinGeckoModule } from '../../data-sources/coingecko/coingecko.module';
import { RedisModule } from '../../redis/redis.module';
import { CacheUpdateService } from './cache-update.service';
import { DataSourcesModule } from '../../data-sources/data-sources.module';
import { HyperliquidWsModule } from '../../data-sources/hyperliquid/hyperliquid-ws.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule,
    HttpModule,
    BinanceModule,
    BybitModule,
    HyperLiquidModule,
    CoinGeckoModule,
    RedisModule,
    DataSourcesModule,
    HyperliquidWsModule,
  ],
  providers: [CacheUpdateService],
  exports: [CacheUpdateService], // CacheUpdateService'i (ve içindeki stream'i) diğer modüllerin kullanabilmesi için export et
})
export class CacheUpdateModule {} 