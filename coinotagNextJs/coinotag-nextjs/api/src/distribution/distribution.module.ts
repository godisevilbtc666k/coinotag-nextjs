import { Module } from '@nestjs/common';
import { EventsModule } from './events/events.module';
import { TickersModule } from './tickers/tickers.module';
// Eğer TickerDataController varsa:
// import { TickerDataController } from './ticker-data/ticker-data.controller';

@Module({
  imports: [EventsModule, TickersModule],
  // Eğer TickerDataController varsa ve burada tanımlanacaksa:
  // controllers: [TickerDataController],
  exports: [EventsModule, TickersModule],
})
export class DistributionModule {}
