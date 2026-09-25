import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, Rol, Roles, RolesGuard } from '@turnos-platform/auth';
import type { Response } from 'express';
import { ContrasenaService } from './contrasena.service';
import { ContextoDb } from '@turnos-platform/tenant';
import { CrearUsuarioDto } from './dto/crear-usuario.dto';
import { RolUsuario } from './entities/usuario.entity';
import { ListarUsuariosQueryDto } from './dto/listar-usuarios-query.dto';
import { UsuariosService } from './usuarios.service';

@Controller('usuarios')
export class UsuariosController {
  constructor(
    private readonly usuariosService: UsuariosService,
    private readonly contrasenaService: ContrasenaService,
    private readonly db: ContextoDb,
  ) {}

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
    // Sprint 20: el personal nace en el taller de la sesion; el cliente es
    // una cuenta global que queda relacionada con ese taller. Un superadmin
    // tiene que haber elegido taller (X-Taller).
    const tallerId = this.db.exigirTaller();
    const esPersonal =
      dto.rol === RolUsuario.ADMIN || dto.rol === RolUsuario.TECNICO;
    const usuario = await this.usuariosService.create({
      ...dto,
      tallerId: esPersonal ? tallerId : null,
      vincularA: esPersonal ? null : tallerId,
    });
    const { passwordHash: _passwordHash, ...usuarioSinPassword } = usuario;

    // Sin password (Sprint 18): la cuenta nace con una al azar que nadie
    // conoce y el usuario recibe por correo el enlace para definir la suya.
    // `invitacion.enviada` le dice al admin si el correo salio de verdad.
    if (!dto.password) {
      const invitacion = await this.contrasenaService.emitir(usuario, 'alta');
      return { ...usuarioSinPassword, invitacion };
    }
    return usuarioSinPassword;
  }

  // Sprint 21: baja y reactivacion de tecnicos del taller.
  @Post(':id/baja')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Rol.ADMIN)
  @HttpCode(HttpStatus.OK)
  darDeBaja(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.usuariosService.darDeBaja(id);
  }

  @Post(':id/reactivar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Rol.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  reactivar(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.usuariosService.reactivar(id);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Rol.ADMIN)
  listar(@Query() query: ListarUsuariosQueryDto) {
    return this.usuariosService.findAll(query.rol);
  }
}
