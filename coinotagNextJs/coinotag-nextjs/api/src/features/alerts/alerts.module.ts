import { Module } from '@nestjs/common';
import { RedisModule } from '../../redis/redis.module';
import { CacheUpdateModule } from '../../processing/cache-update/cache-update.module';
import { AlertsService } from './alerts.service';
import { AlertsController } from './alerts.controller';

@Module({
  imports: [
    RedisModule,       // AlertsService Redis kullanıyor
    CacheUpdateModule, // AlertsService ticker stream'i kullanıyor
  ],
  providers: [AlertsService],
  controllers: [AlertsController],
  exports: [AlertsService], // Servisi dışarı açmak gerekirse
})
export class AlertsModule {} 