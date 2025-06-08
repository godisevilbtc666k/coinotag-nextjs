import { Module } from '@nestjs/common';
import { HyperliquidWsService } from './hyperliquid-ws.service';

@Module({
  providers: [HyperliquidWsService],
  exports: [HyperliquidWsService],
})
export class HyperliquidWsModule {} 