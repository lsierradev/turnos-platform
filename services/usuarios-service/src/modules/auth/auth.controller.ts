import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ContrasenaService } from '../usuarios/contrasena.service';
import { AuthService } from './auth.service';
import {
  RestablecerContrasenaDto,
  SolicitarRestablecimientoDto,
} from './dto/contrasena.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly contrasenaService: ContrasenaService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() { email, password }: LoginDto) {
    const usuario = await this.authService.validateUser(email, password);
    return this.authService.login(usuario);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() { refreshToken }: RefreshTokenDto) {
    return this.authService.refresh(refreshToken);
  }

  // Publicos, como login: quien olvido la contrasena no tiene token.
  // 202 siempre, exista o no el correo (ver solicitarRestablecimiento).
  @Post('olvide')
  @HttpCode(HttpStatus.ACCEPTED)
  async olvide(@Body() { email }: SolicitarRestablecimientoDto) {
    await this.contrasenaService.solicitarRestablecimiento(email);
  }

  @Post('restablecer')
  @HttpCode(HttpStatus.NO_CONTENT)
  async restablecer(@Body() { token, password }: RestablecerContrasenaDto) {
    await this.contrasenaService.restablecer(token, password);
  }
}
