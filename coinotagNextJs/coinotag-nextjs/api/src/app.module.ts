import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { HttpModule } from '@nestjs/axios';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RedisModule } from './redis/redis.module';
import { BinanceModule } from './data-sources/binance/binance.module';
import { BybitModule } from './data-sources/bybit/bybit.module';
import { HyperLiquidModule } from './data-sources/hyperliquid/hyperliquid.module';
import { HyperliquidWsModule } from './data-sources/hyperliquid/hyperliquid-ws.module';
import { CoinGeckoModule } from './data-sources/coingecko/coingecko.module';
import { CacheUpdateModule } from './processing/cache-update/cache-update.module';
import { EventsModule } from './distribution/events/events.module';
import { TickersModule } from './distribution/tickers/tickers.module';
import { TickerDataController } from './distribution/ticker-data/ticker-data.controller';
import { TechnicalAnalysisModule } from './features/technical-analysis/technical-analysis.module';
import { AlertsModule } from './features/alerts/alerts.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    HttpModule,
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    RedisModule,
    BybitModule,
    BinanceModule,
    HyperLiquidModule,
    HyperliquidWsModule,
    CoinGeckoModule,
    CacheUpdateModule,
    EventsModule,
    TickersModule,
    TechnicalAnalysisModule,
    AlertsModule,
  ],
  controllers: [AppController, TickerDataController],
  providers: [AppService, Logger],
})
export class AppModule {} 