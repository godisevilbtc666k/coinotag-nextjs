import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { HyperLiquidService } from './hyperliquid.service';

@Module({
  imports: [
    HttpModule,
    ConfigModule,
  ],
  providers: [HyperLiquidService],
  exports: [HyperLiquidService],
})
export class HyperLiquidModule {} 