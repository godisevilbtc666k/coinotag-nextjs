import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TechnicalAnalysisService } from './technical-analysis.service';
import { TechnicalAnalysisController } from './technical-analysis.controller';

@Module({
  imports: [
    HttpModule, // TechnicalAnalysisService K-line çekmek için HttpService kullanıyor
  ],
  providers: [TechnicalAnalysisService],
  controllers: [TechnicalAnalysisController],
  exports: [TechnicalAnalysisService], // Servisi dışarıya açmak gerekirse
})
export class TechnicalAnalysisModule {} 