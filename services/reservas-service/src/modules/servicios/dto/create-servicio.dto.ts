import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CategoriaServicio } from '../entities/servicio.entity';

// La columna precio es NUMERIC(10, 2): 8 digitos enteros + 2 decimales.
// Un valor mayor no da un error de validacion sino un "numeric field
// overflow" de Postgres, que sale como 500.
const PRECIO_MAXIMO = 99_999_999.99;

// El motor de reservas solo agenda dentro del horario laboral 08:00-18:00
// (ver sugerencias-horarios.util.ts). Un servicio mas largo que esa ventana
// es imposible de reservar: POST /appointments lo aceptaria y despues no
// encontraria jamas un hueco, y las sugerencias ante conflicto volverian
// siempre vacias.
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

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(PRECIO_MAXIMO)
  precio: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
