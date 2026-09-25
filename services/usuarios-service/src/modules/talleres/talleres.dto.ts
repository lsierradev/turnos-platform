import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

class AdminInicialDto {
  @IsString()
  @MinLength(2)
  nombre: string;

  @IsEmail()
  email: string;
}

export class CrearTallerDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nombre: string;

  // Mismo formato que la CHECK talleres_slug_formato (migracion 015).
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug: solo minusculas, numeros y guiones (ej. taller-norte)',
  })
  @MaxLength(60)
  slug: string;

  /** El primer admin del taller: recibe el enlace para definir su contrasena. */
  @ValidateNested()
  @Type(() => AdminInicialDto)
  admin: AdminInicialDto;
}

export class ActualizarTallerDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nombre?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
