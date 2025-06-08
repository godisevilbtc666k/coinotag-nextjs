import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios'; // Gerekli olacak
import { ConfigModule } from '@nestjs/config'; // Gerekli olacak
import { EventEmitterModule } from '@nestjs/event-emitter'; // Gerekli olabilir

// Yeni servisleri import et
import { BybitSpotWsService } from './spot/bybit-spot-ws.service';
import { BybitFuturesWsService } from './futures/bybit-futures-ws.service';

@Module({
  imports: [
    HttpModule, 
    ConfigModule,
    EventEmitterModule.forRoot(), // Eğer event kullanacaksak
  ],
  providers: [BybitSpotWsService, BybitFuturesWsService], // Yeni servisleri provider yap
  // exports: [BybitSpotWsService, BybitFuturesWsService], // Servisler oluşturulunca eklenecek
  exports: [BybitSpotWsService, BybitFuturesWsService], // Yeni servisleri export et
})
export class BybitModule {} 