import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { RolUsuario } from '../entities/usuario.entity';

export class CrearUsuarioDto {
  @IsEmail()
  email: string;

  // Opcional desde Sprint 17: un admin que da de alta a un cliente desde el
  // formulario de reserva no la define (ver UsuariosService.create).
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsString()
  @MinLength(1)
  nombre: string;

  // Superadmin no: se crea solo por seed, nunca desde la API (Sprint 20).
  @IsOptional()
  @IsIn([RolUsuario.ADMIN, RolUsuario.TECNICO, RolUsuario.CLIENTE], {
    message: 'rol debe ser admin, tecnico o cliente',
  })
  rol?: RolUsuario;

  @IsOptional()
  @IsString()
  telefono?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  ciudad?: string;
}
