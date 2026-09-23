import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ReservasService } from './reservas.service';

@Controller('reservas')
export class ReservasController {
  constructor(private readonly reservasService: ReservasService) {}

  @Get('health')
  health() {
    return this.reservasService.health();
  }

  // 503 y no 200 cuando alguna dependencia esta caida: un readiness que
  // siempre responde 200 no sirve para nada, porque el orquestador y el
  // balanceador miran el codigo de estado, no el cuerpo.
  @Get('health/ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const resultado = await this.reservasService.readiness();
    res.status(
      resultado.status === 'ok'
        ? HttpStatus.OK
        : HttpStatus.SERVICE_UNAVAILABLE,
    );
    return resultado;
  }
}
