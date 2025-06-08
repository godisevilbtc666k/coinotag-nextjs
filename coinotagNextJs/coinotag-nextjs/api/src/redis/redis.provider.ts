import { FactoryProvider, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';
import { DIRECT_REDIS_CLIENT } from './redis.constants';

export const redisProvider: FactoryProvider<Promise<RedisClientType>> = {
  provide: DIRECT_REDIS_CLIENT,
  // ConfigService inject etmeye gerek yok
  // inject: [ConfigService],
  // Factory'de ConfigService parametresini kaldır
  useFactory: async (): Promise<RedisClientType> => {
    const logger = new Logger('RedisProvider');
    // UPSTASH_REDIS_URL'yi kullanma
    // const redisUrl = configService.get<string>('UPSTASH_REDIS_URL');

    // Lokal Redis bağlantı bilgilerini kullan
    const redisHost = '127.0.0.1';
    const redisPort = 3129;

    // URL kontrolünü kaldır
    // if (!redisUrl) {
    //   logger.error('UPSTASH_REDIS_URL is not defined in environment variables.');
    //   throw new Error('Redis URL is not configured.');
    // }

    // Lokal bağlantı için log mesajını güncelle
    logger.log(`Connecting to Local Redis at ${redisHost}:${redisPort}...`);

    const client: RedisClientType = createClient({
      // URL yerine socket bilgilerini kullan
      // url: redisUrl,
      socket: {
        host: redisHost,
        port: redisPort,
        connectTimeout: 10000 // Bağlantı zaman aşımı (opsiyonel)
      }
    });

    client.on('error', (err) => {
      logger.error('Redis Client Error', err);
    });

    client.on('connect', () => {
      // Log mesajını lokalleştir
      logger.log('Successfully connected to Local Redis.');
    });

    client.on('reconnecting', () => {
      // Log mesajını lokalleştir
      logger.warn('Local Redis client is reconnecting...');
    });

    try {
      await client.connect();
      return client as RedisClientType; 
    } catch (err) {
      // Hata mesajını lokalleştir
      logger.error('Failed to connect to Local Redis during initial connection.', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to connect to Local Redis: ${errorMessage}`);
    }
  },
}; 