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

    // Personal de un taller dado de baja: no entra (Sprint 20). Se chequea
    // DESPUES de la contrasena, para no revelar el estado del taller a
    // quien no la sabe.
    if (
      usuario.tallerId &&
      !(await this.usuariosService.tallerActivo(usuario.tallerId))
    ) {
      throw new UnauthorizedException(
        'Tu taller esta dado de baja en TurnoPro.',
      );
    }

    return usuario;
  }

  async login(usuario: Usuario): Promise<TokensResponse> {
    const payload: JwtPayload = {
      sub: usuario.id,
      email: usuario.email,
      rol: usuario.rol,
      taller: usuario.tallerId ?? null,
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

    // Sprint 19: el refresh se revisa contra la base. Un usuario borrado o
    // que cambio la contrasena despues de emitido este token ya no renueva:
    // asi cambiar la contrasena cierra las otras sesiones (en a lo sumo lo
    // que le quede al access token, 15 min). `iat` viene en segundos: se
    // compara contra el segundo de la marca, para no rechazar el token que
    // se emite en el mismo segundo del cambio (el del login siguiente).
    const usuario = await this.usuariosService.findById(payload.sub);
    const iat = (payload as JwtPayload & { iat?: number }).iat ?? 0;
    const desde = usuario?.sesionesValidasDesde;
    if (!usuario || (desde && iat < Math.floor(desde.getTime() / 1000))) {
      throw new UnauthorizedException(
        'La sesion se cerro porque cambio la contrasena. Volve a ingresar.',
      );
    }

    // Rol y email de la base, no del token viejo: si un admin le cambio el
    // rol, el proximo access token ya lo refleja.
    return {
      accessToken: this.jwtService.sign({
        sub: usuario.id,
        email: usuario.email,
        rol: usuario.rol,
        taller: usuario.tallerId ?? null,
      }),
    };
  }
}
