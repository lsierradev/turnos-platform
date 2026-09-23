import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { UsuariosService } from './usuarios.service';

@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuariosService: UsuariosService) {}

  @Get('health')
  health() {
    return this.usuariosService.health();
  }

  @Get('health/ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const resultado = await this.usuariosService.readiness();
    res.status(
      resultado.status === 'ok'
        ? HttpStatus.OK
        : HttpStatus.SERVICE_UNAVAILABLE,
    );
    return resultado;
  }
}
