import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthModule } from '@turnos-platform/auth';
import { ContrasenaService } from './contrasena.service';
import { CorreoService } from './correo.service';
import { TokenContrasena } from './entities/token-contrasena.entity';
import { Usuario } from './entities/usuario.entity';
import { UsuariosController } from './usuarios.controller';
import { UsuariosService } from './usuarios.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Usuario, TokenContrasena]),
    JwtAuthModule,
  ],
  controllers: [UsuariosController],
  providers: [UsuariosService, ContrasenaService, CorreoService],
  exports: [UsuariosService, ContrasenaService],
})
export class UsuariosModule {}
