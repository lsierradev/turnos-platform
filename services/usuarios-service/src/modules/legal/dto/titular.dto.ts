import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RectificarDatosDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nombre?: string;

  // Vacio = borrarlo (el telefono es opcional).
  @IsOptional()
  @IsString()
  @MaxLength(30)
  telefono?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  ciudad?: string;
}

export class SuprimirCuentaDto {
  @IsString()
  @MinLength(1)
  password: string;
}
