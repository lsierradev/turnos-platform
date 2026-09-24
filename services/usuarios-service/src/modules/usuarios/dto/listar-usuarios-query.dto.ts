import { IsEnum, IsOptional } from 'class-validator';
import { RolUsuario } from '../entities/usuario.entity';

export class ListarUsuariosQueryDto {
  @IsOptional()
  @IsEnum(RolUsuario)
  rol?: RolUsuario;
}
