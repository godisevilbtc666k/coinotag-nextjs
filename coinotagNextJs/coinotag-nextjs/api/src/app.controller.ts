import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // İleride sağlık kontrolü (health check) endpoint'i eklenebilir
  // @Get('/health')
  // getHealth(): string {
  //   return this.appService.getHealth();
  // }
} 