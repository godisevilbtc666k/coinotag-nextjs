import { Module } from '@nestjs/common';
import { TickersController } from './tickers.controller';
import { CacheUpdateModule } from '../../processing/cache-update/cache-update.module';

@Module({
  imports: [
    CacheUpdateModule, // CacheUpdateService'i kullanabilmek için import et
  ],
  controllers: [TickersController],
})
export class TickersModule {} 