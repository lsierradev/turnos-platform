import { IsEmail, IsString, Length, MinLength } from 'class-validator';

export class SolicitarRestablecimientoDto {
  @IsEmail()
  email: string;
}

export class RestablecerContrasenaDto {
  // 32 bytes en base64url = 43 caracteres.
  @IsString()
  @Length(43, 43)
  token: string;

  // Mismo minimo que LoginDto y CrearUsuarioDto.
  @IsString()
  @MinLength(8)
  password: string;
}
