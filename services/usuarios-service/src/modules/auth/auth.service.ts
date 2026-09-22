import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  JWT_REFRESH_SECRET_FALLBACK_DEV,
  JwtPayload,
  secretoRequerido,
} from '@turnos-platform/auth';
import * as bcrypt from 'bcryptjs';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { UsuariosService } from '../usuarios/usuarios.service';

export interface TokensResponse {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usuariosService: UsuariosService,
    private readonly jwtService: JwtService,
  ) {}

  async validateUser(email: string, password: string): Promise<Usuario> {
    const usuario = await this.usuariosService.findByEmail(email);
    if (!usuario) {
      throw new UnauthorizedException('Credenciales invalidas');
    }

    const passwordValida = await bcrypt.compare(password, usuario.passwordHash);
    if (!passwordValida) {
      throw new UnauthorizedException('Credenciales invalidas');
    }

    return usuario;
  }

  async login(usuario: Usuario): Promise<TokensResponse> {
    const payload: JwtPayload = {
      sub: usuario.id,
      email: usuario.email,
      rol: usuario.rol,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      refreshToken: this.jwtService.sign(payload, {
        secret: secretoRequerido(
          'JWT_REFRESH_SECRET',
          JWT_REFRESH_SECRET_FALLBACK_DEV,
        ),
        expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
      }),
    };
  }

  async refresh(
    refreshToken: string,
  ): Promise<Pick<TokensResponse, 'accessToken'>> {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: secretoRequerido(
          'JWT_REFRESH_SECRET',
          JWT_REFRESH_SECRET_FALLBACK_DEV,
        ),
      });
    } catch {
      throw new UnauthorizedException('Refresh token invalido o expirado');
    }

    const { sub, email, rol } = payload;
    return {
      accessToken: this.jwtService.sign({ sub, email, rol }),
    };
  }
}
