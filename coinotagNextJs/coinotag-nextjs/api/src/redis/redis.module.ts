import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { redisProvider } from './redis.provider';

// @Global() // Eğer Redis client'ını her yerde import etmeden kullanmak istersen global yapabilirsin.
@Module({
  imports: [ConfigModule], // ConfigService'i provider içinde kullanabilmek için import ediyoruz.
  providers: [redisProvider],
  exports: [redisProvider], // Başka modüllerin Redis client'ını inject edebilmesi için export ediyoruz.
})
export class RedisModule {} 