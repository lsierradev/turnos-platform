import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Borrador de la recepcion; se reemplaza entero mientras no se acepte. */
export class RecepcionDto {
  @IsUUID()
  vehiculoId: string;

  @IsInt()
  @Min(0)
  @Max(3_000_000)
  kilometraje: number;

  /** Cuartos de tanque: 0 = reserva, 4 = lleno. */
  @IsInt()
  @Min(0)
  @Max(4)
  nivelCombustible: number;

  /** Rayones, golpes, testigos encendidos... lo que se ve al recibirlo. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  estadoVehiculo: string;

  /** Lo que el cliente deja adentro. Vacio = "Ninguno". */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  objetosDejados?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  observaciones?: string;

  /** Si no viene, el fin del turno. */
  @IsOptional()
  @IsISO8601()
  fechaProbableEntrega?: string;
}

export const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type TipoFoto = (typeof TIPOS_FOTO)[number];

export class FotoDto {
  @IsIn(TIPOS_FOTO)
  tipoMime: TipoFoto;

  /**
   * Base64 (sin el prefijo data:). El navegador la achica antes de subirla;
   * el tope real (2 MB decodificada) lo valida el servicio.
   */
  @IsString()
  @MaxLength(2_900_000)
  datos: string;
}

export class AceptarRecepcionDto {
  /**
   * Solo en el mostrador (personal del taller): quien entrega el vehiculo.
   * Desde su cuenta, el cliente no los manda: es el titular.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  nombre?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  documento?: string;
}
