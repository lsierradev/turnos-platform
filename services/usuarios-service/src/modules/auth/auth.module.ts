import { Module } from '@nestjs/common';
import { JwtAuthModule } from '@turnos-platform/auth';
import { UsuariosModule } from '../usuarios/usuarios.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [JwtAuthModule, UsuariosModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
