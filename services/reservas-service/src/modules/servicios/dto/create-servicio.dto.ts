import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  ANTICIPO_MAXIMO,
  ANTICIPO_MINIMO,
  TARIFAS_IVA,
  type TarifaIva,
} from '../../../common/precios.util';
import { CategoriaServicio } from '../entities/servicio.entity';

// Sprint 21: centavos enteros (bigint en la base). Tope de $1.000 millones:
// holgado para cualquier servicio de taller y lejos del limite de enteros
// seguros de JS.
const PRECIO_MAXIMO_CENTAVOS = 100_000_000_000;

// El motor de reservas solo agenda dentro del horario del taller. Un
// servicio mas largo que cualquier jornada es imposible de reservar:
// POST /appointments lo aceptaria y despues no encontraria jamas un hueco.
// 10 h cubre la jornada historica (08-18); el horario de cada taller se
// valida al reservar.
const DURACION_MAXIMA_MINUTOS = 10 * 60;

export class CreateServicioDto {
  // @IsString() solo no alcanzaba: "" es un string valido, asi que se podian
  // crear servicios sin nombre, que despues aparecen en blanco en la agenda
  // del tecnico y en el selector de reserva.
  @IsNotEmpty()
  @MaxLength(120)
  nombre: string;

  @IsEnum(CategoriaServicio)
  categoria: CategoriaServicio;

  @IsInt()
  @IsPositive()
  @Max(DURACION_MAXIMA_MINUTOS)
  duracionMinutos: number;

  /** Valor BASE (sin IVA), en centavos. */
  @IsInt()
  @Min(0)
  @Max(PRECIO_MAXIMO_CENTAVOS)
  precioBaseCentavos: number;

  @IsOptional()
  @IsIn(TARIFAS_IVA)
  tarifaIva?: TarifaIva;

  @IsOptional()
  @IsBoolean()
  requiereAnticipo?: boolean;

  /** 15-20; obligatorio si requiereAnticipo. */
  @ValidateIf(
    (o: CreateServicioDto) =>
      o.requiereAnticipo === true || o.porcentajeAnticipo != null,
  )
  @IsInt()
  @Min(ANTICIPO_MINIMO)
  @Max(ANTICIPO_MAXIMO)
  porcentajeAnticipo?: number | null;

  /** Termino de garantia en dias (Decreto 735 de 2013); null = no definido. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  garantiaDias?: number | null;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
