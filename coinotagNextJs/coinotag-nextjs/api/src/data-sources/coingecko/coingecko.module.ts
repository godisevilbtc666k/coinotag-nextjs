import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config'; // Service ConfigService kullanıyor
import { RedisModule } from '../../redis/redis.module'; // Service Redis client kullanıyor
import { CoinGeckoService } from './coingecko.service';
import { CoinGeckoController } from './coingecko.controller';

@Module({
  imports: [
    HttpModule, // HTTP istekleri için
    ConfigModule,
    RedisModule,
  ],
  providers: [CoinGeckoService],
  controllers: [CoinGeckoController],
  exports: [CoinGeckoService], // Servisi belki başka modüller de kullanmak ister
})
export class CoinGeckoModule {} 