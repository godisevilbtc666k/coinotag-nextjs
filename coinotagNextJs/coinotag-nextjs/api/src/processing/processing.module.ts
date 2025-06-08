import { Module } from '@nestjs/common';
import { CacheUpdateModule } from './cache-update/cache-update.module';

@Module({
  imports: [CacheUpdateModule],
  exports: [CacheUpdateModule], // CacheUpdateService'i dışarı açmak için
})
export class ProcessingModule {}
