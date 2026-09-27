import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Checkout: solo el turno y el concepto. El monto NO viene del navegador:
 * lo calcula el backend con el turno de la base.
 */
export class CheckoutDto {
  @IsUUID()
  turnoId: string;

  @IsIn(['anticipo', 'saldo'])
  concepto: 'anticipo' | 'saldo';
}

export class TurnoPagosQueryDto {
  @IsUUID()
  turnoId: string;
}

export class ReferenciaParamDto {
  @Matches(/^tp_[0-9a-f]{32}$/, { message: 'referencia invalida' })
  referencia: string;
}

/** Pago en el mostrador: aca si lo dice el personal (lo recibio en mano). */
export class PagoPresencialDto {
  @IsUUID()
  turnoId: string;

  @IsIn(['anticipo', 'saldo'])
  concepto: 'anticipo' | 'saldo';

  @IsIn(['efectivo', 'datafono', 'transferencia'])
  medio: 'efectivo' | 'datafono' | 'transferencia';

  /** Sin monto: todo lo pendiente del concepto. Un abono parcial, menor. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000_000_00)
  montoCentavos?: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  comprobante?: string;
}

export class CompletarReembolsoDto {
  /** Como se devolvio: "Transferencia Bancolombia 123", "Efectivo en caja". */
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  nota: string;
}

export class DisputaDto {
  @IsIn(['reversion', 'contracargo'])
  tipo: 'reversion' | 'contracargo';

  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  detalle: string;
}

export class ResolverDisputaDto {
  /** revertido: el dinero volvio al cliente. a_favor: se quedo en el taller. */
  @IsIn(['revertido', 'a_favor'])
  resultado: 'revertido' | 'a_favor';
}

export class FiltroQueryDto {
  @IsOptional()
  @IsIn(['pendientes', 'todos'])
  estado?: 'pendientes' | 'todos';
}

export class CajaQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fecha debe ser YYYY-MM-DD' })
  fecha: string;
}

export class CierreCajaDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fecha debe ser YYYY-MM-DD' })
  fecha: string;

  /** Efectivo contado en la caja al cerrar. */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  contadoCentavos: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  nota?: string;
}
