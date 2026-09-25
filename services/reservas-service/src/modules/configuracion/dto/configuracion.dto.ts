import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

// Cuartos de hora de 00:00 a 23:45: la grilla de reserva avanza de a 15
// minutos, y un cierre a las 24:00 cruzaria de dia.
const HORA_CUARTO = /^([01][0-9]|2[0-3]):(00|15|30|45)$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export class DatosFiscalesDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  razonSocial: string;

  /** Con o sin puntos; sin el digito de verificacion (va en dv). */
  @IsString()
  @Matches(/^[0-9.\s]{5,20}$/, {
    message: 'El NIT solo lleva numeros (sin el digito de verificacion).',
  })
  nit: string;

  @IsInt()
  @Min(0)
  @Max(9)
  dv: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  direccion: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  municipio: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  departamento: string;

  @IsBoolean()
  responsableIva: boolean;
}

export class FacturacionDto {
  @IsIn(['alegra', 'siigo'])
  proveedor: 'alegra' | 'siigo';

  /** En Alegra, el correo de la cuenta. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  usuario: string;

  @IsString()
  @MinLength(8)
  @MaxLength(500)
  token: string;
}

export class WompiDto {
  @IsIn(['pruebas', 'produccion'])
  ambiente: 'pruebas' | 'produccion';

  @IsString()
  @MinLength(10)
  @MaxLength(200)
  llavePublica: string;

  // Los secretos son opcionales al ACTUALIZAR: la pantalla nunca los
  // tiene (la API solo devuelve los ultimos 4), asi que cambiar el ambiente
  // o la llave publica no obliga a volver a pegarlos... salvo que no haya
  // ninguno guardado (lo decide el servicio).
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  llavePrivada?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  secretoIntegridad?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  secretoEventos?: string;
}

export class DiaHorarioDto {
  @IsInt()
  @Min(1)
  @Max(7)
  dia: number;

  @Matches(HORA_CUARTO, {
    message: 'La apertura va en cuartos de hora (HH:00, :15, :30 o :45).',
  })
  apertura: string;

  @Matches(HORA_CUARTO, {
    message: 'El cierre va en cuartos de hora (HH:00, :15, :30 o :45).',
  })
  cierre: string;
}

export class HorarioDto {
  /** Solo los dias que atiende; un dia ausente queda cerrado. */
  @ValidateNested({ each: true })
  @Type(() => DiaHorarioDto)
  @ArrayMaxSize(7)
  dias: DiaHorarioDto[];
}

export class FeriadoDto {
  @Matches(FECHA, { message: 'fecha debe ser YYYY-MM-DD' })
  fecha: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  motivo: string;
}

export class FestivosColombiaDto {
  @IsInt()
  @Min(2000)
  @Max(2100)
  anio: number;
}
