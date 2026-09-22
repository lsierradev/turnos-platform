import { Controller, Get } from '@nestjs/common';
import { ReservasService } from './reservas.service';

@Controller('reservas')
export class ReservasController {
  constructor(private readonly reservasService: ReservasService) {}

  @Get('health')
  health() {
    return this.reservasService.health();
  }
}
