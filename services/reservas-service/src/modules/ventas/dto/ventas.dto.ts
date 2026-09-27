import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const MEDIOS_PAGO_VENTA = [
  'efectivo',
  'datafono',
  'transferencia',
  'wompi',
  'otro',
] as const;
export type MedioPagoVenta = (typeof MEDIOS_PAGO_VENTA)[number];

export const ESTADOS_ORDEN_VENTA = [
  'borrador',
  'confirmada',
  'pagada',
  'anulada',
] as const;
export type EstadoOrdenVenta = (typeof ESTADOS_ORDEN_VENTA)[number];

export class CrearOrdenDto {
  /** El turno del que sale la orden; sin este campo, venta de mostrador. */
  @IsOptional()
  @IsUUID()
  turnoId?: string;

  /** Cliente titular (para la cotizacion). Si hay turno, se toma el suyo. */
  @IsOptional()
  @IsUUID()
  usuarioId?: string;
}

export class AgregarLineaServicioDto {
  @IsUUID()
  servicioId: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  @Max(1_000)
  cantidad?: number;
}

export class AgregarLineaRepuestoDto {
  @IsUUID()
  itemId: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  @Max(1_000_000)
  cantidad: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  descuentoPorcentaje?: number;
}

export class ActualizarLineaDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  @Max(1_000_000)
  cantidad?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  descuentoPorcentaje?: number;
}

export class MarcarPagadaDto {
  @IsIn(MEDIOS_PAGO_VENTA)
  medioPago: MedioPagoVenta;

  @IsOptional()
  @IsNotEmpty()
  @MaxLength(80)
  comprobante?: string;
}

export class AnularOrdenDto {
  @MinLength(10, { message: 'Contanos por que se anula (minimo 10 caracteres).' })
  @MaxLength(500)
  motivo: string;
}

export class OrdenesQueryDto {
  @IsOptional()
  @IsIn(ESTADOS_ORDEN_VENTA)
  estado?: EstadoOrdenVenta;

  @IsOptional()
  @IsUUID()
  turnoId?: string;
}
