import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true, // ConfigModule'ü global yaparak her yerde erişilebilir hale getirir.
      // envFilePath: '.env', // Varsayılan olarak .env dosyasını arar, gerekirse değiştirilebilir.
      // ignoreEnvFile: process.env.NODE_ENV === 'production', // Prod ortamında .env dosyasını yok say (opsiyonel)
      // validationSchema: Joi.object({...}), // Ortam değişkenleri için validasyon şeması (opsiyonel)
    }),
  ],
  exports: [NestConfigModule], // Diğer modüllerin de ConfigService'i kullanabilmesi için
})
export class ConfigModule {} 