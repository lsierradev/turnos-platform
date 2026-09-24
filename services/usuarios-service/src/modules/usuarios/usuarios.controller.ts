import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, Rol, Roles, RolesGuard } from '@turnos-platform/auth';
import type { Response } from 'express';
import { CrearUsuarioDto } from './dto/crear-usuario.dto';
import { ListarUsuariosQueryDto } from './dto/listar-usuarios-query.dto';
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

  // Guards a nivel de metodo y no de controller: /usuarios/health y
  // /usuarios/health/ready los usan las probes de k8s y
  // infra/scripts/verificar-salud.sh sin token (ver docs/DESPLIEGUE.md).
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Rol.ADMIN)
  async crear(@Body() dto: CrearUsuarioDto) {
    const usuario = await this.usuariosService.create(dto);
    const { passwordHash: _passwordHash, ...usuarioSinPassword } = usuario;
    return usuarioSinPassword;
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Rol.ADMIN)
  listar(@Query() query: ListarUsuariosQueryDto) {
    return this.usuariosService.findAll(query.rol);
  }
}
