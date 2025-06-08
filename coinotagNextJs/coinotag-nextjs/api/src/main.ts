import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

// Özel Bybit Logger
// class BybitOnlyLogger implements LoggerService { ... } // Geçici olarak devre dışı bırakıldı

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Global log seviyesi: Hata, Uyarı ve Debug mesajları görünsün
    logger: ['error', 'warn', 'debug'], 
  });

  const port = process.env.PORT || 3333;

  // CORS ayarları: localhost ve yerel IP'ye izin ver + EventSource headers
  const allowedOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:3000', // Frontend 3000 portunda çalışıyor
    'http://localhost:3001', // Add port 3001
    'http://192.168.1.109:3000', // Eski IP
    'http://192.168.1.109:3001',
    "http://192.168.1.160:3333",
    "http://192.168.1.160:3000",
    "http://192.168.1.160:3001",
    "http://localhost:3333",
    "http://localhost:3000", // Açık olarak ekledim
  ];

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      
      // DEBUG: Log origin checks
      console.log(`🌐 CORS Check - Origin: ${origin}`);
      
      if (allowedOrigins.indexOf(origin) === -1) {
        console.error(`❌ CORS Rejected - Origin: ${origin}`);
        const msg =
          'The CORS policy for this site does not ' +
          'allow access from the specified Origin.';
        return callback(new Error(msg), false);
      }
      
      console.log(`✅ CORS Allowed - Origin: ${origin}`);
      return callback(null, true);
    },
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization', 
      'Cache-Control',
      'Accept',
      'X-Requested-With',
      'Accept-Encoding',
      'Accept-Language',
      'Connection',
      'User-Agent',
      'Referer',
      'Origin',
      'X-Forwarded-For',
      'X-Real-IP'
    ],
    exposedHeaders: [
      'Content-Type',
      'Cache-Control',
      'Connection',
      'Access-Control-Allow-Origin',
      'Access-Control-Allow-Methods',
      'Access-Control-Allow-Headers'
    ],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204
  });

  // TODO: global pipe/filter/interceptor eklenecek
  // Listen on all network interfaces
  await app.listen(port, '0.0.0.0');
  Logger.log(
    `🚀 API Gateway is running on: http://localhost:${port} and accessible on the network`,
    'Bootstrap',
  );
}
bootstrap(); 