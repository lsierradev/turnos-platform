import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';
import { CategoriaServicio } from '../entities/servicio.entity';

export class CreateServicioDto {
  @IsString()
  nombre: string;

  @IsEnum(CategoriaServicio)
  categoria: CategoriaServicio;

  @IsInt()
  @IsPositive()
  duracionMinutos: number;

  @IsNumber()
  @Min(0)
  precio: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
