import { Module } from '@nestjs/common';
import { CacheUpdateModule } from '../../processing/cache-update/cache-update.module';
import { RedisModule } from '../../redis/redis.module';
import { EventsController } from './events.controller';

@Module({
  imports: [
    CacheUpdateModule, // CacheUpdateService'i (ve stream'i) almak için
    RedisModule,       // Redis client'ı almak için
  ],
  controllers: [EventsController], // SSE endpoint'ini sağlamak için
})
export class EventsModule {} 