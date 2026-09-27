import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { TARIFAS_IVA, type TarifaIva } from '../../../common/precios.util';

// Mismo tope que servicios.precio_base_centavos: holgado para cualquier
// repuesto y lejos del limite de enteros seguros de JS.
const PRECIO_MAXIMO_CENTAVOS = 100_000_000_000;

export const TIPOS_MOVIMIENTO = [
  'entrada',
  'salida',
  'ajuste',
  'devolucion',
] as const;
export type TipoMovimiento = (typeof TIPOS_MOVIMIENTO)[number];

export class CrearItemDto {
  // Codigo del taller para el repuesto; no se vuelve a editar (ver
  // items_inventario_sku_formato, 020).
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9._-]{1,40}$/, {
    message:
      'sku solo admite letras, numeros, punto, guion y guion bajo (hasta 40 caracteres)',
  })
  sku: string;

  @IsNotEmpty()
  @MaxLength(120)
  nombre: string;

  @IsOptional()
  @MaxLength(60)
  marca?: string;

  @IsOptional()
  @MaxLength(20)
  unidad?: string;

  /** Valor BASE (sin IVA), en centavos; igual que los servicios. */
  @IsInt()
  @Min(0)
  @Max(PRECIO_MAXIMO_CENTAVOS)
  precioBaseCentavos: number;

  @IsOptional()
  @IsIn(TARIFAS_IVA)
  tarifaIva?: TarifaIva;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  stockMinimo?: number;
}

export class ActualizarItemDto {
  @IsOptional()
  @IsNotEmpty()
  @MaxLength(120)
  nombre?: string;

  @IsOptional()
  @MaxLength(60)
  marca?: string;

  @IsOptional()
  @MaxLength(20)
  unidad?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PRECIO_MAXIMO_CENTAVOS)
  precioBaseCentavos?: number;

  @IsOptional()
  @IsIn(TARIFAS_IVA)
  tarifaIva?: TarifaIva;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  stockMinimo?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

/**
 * Un movimiento de kardex. `cantidad` siempre positiva: el signo (suma o
 * resta stock) lo decide el tipo, no quien llena el formulario -- ver
 * InventarioService.registrarMovimiento.
 */
export class RegistrarMovimientoDto {
  @IsUUID()
  itemId: string;

  @IsIn(TIPOS_MOVIMIENTO)
  tipo: TipoMovimiento;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  @Max(1_000_000)
  cantidad: number;

  /** Solo para 'ajuste': si sube o baja el stock. */
  @ValidateIf((o: RegistrarMovimientoDto) => o.tipo === 'ajuste')
  @IsIn(['incremento', 'decremento'])
  sentido?: 'incremento' | 'decremento';

  /** Obligatorio en 'entrada': lo que costo comprarlo, por unidad. */
  @ValidateIf((o: RegistrarMovimientoDto) => o.tipo === 'entrada')
  @IsInt()
  @Min(0)
  @Max(PRECIO_MAXIMO_CENTAVOS)
  costoUnitarioCentavos?: number;

  @ValidateIf((o: RegistrarMovimientoDto) => o.tipo === 'entrada')
  @IsNotEmpty()
  @MaxLength(120)
  proveedor?: string;

  @ValidateIf((o: RegistrarMovimientoDto) => o.tipo === 'entrada')
  @IsNotEmpty()
  @MaxLength(60)
  facturaProveedor?: string;

  /** Solo 'salida': el turno en el que se uso (vacio = venta de mostrador). */
  @ValidateIf((o: RegistrarMovimientoDto) => o.turnoId !== undefined)
  @IsUUID()
  turnoId?: string;

  /**
   * Obligatorio en 'ajuste' (por que se corrigio el stock; lo exige ademas
   * movimientos_inventario_ajuste_con_motivo en la base). Libre y opcional
   * en el resto -- una nota, p. ej. a quien se le vendio.
   */
  @ValidateIf((o: RegistrarMovimientoDto) => o.tipo === 'ajuste')
  @IsNotEmpty({ message: 'Indica el motivo del ajuste (minimo 5 caracteres).' })
  @MinLength(5)
  @MaxLength(300)
  motivo?: string;
}

export class ItemsQueryDto {
  // String, no boolean: en una query string "false" sigue siendo un texto
  // no vacio, y @Type(() => Boolean) lo convertiria en `true` igual.
  @IsOptional()
  @IsIn(['activos', 'todos'])
  estado?: 'activos' | 'todos';
}

export class KardexQueryDto {
  @IsUUID()
  itemId: string;
}
