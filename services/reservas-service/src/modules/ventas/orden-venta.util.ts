import { formatearPesos } from '../../common/dinero.util';
import { porcentajeRedondeado, type TarifaIva } from '../../common/precios.util';

/**
 * Calculos de una orden de venta (Sprint 26): totales por linea (servicio o
 * repuesto) y de la orden completa. Aislado del servicio para poder
 * probarlo sin base de datos -- es la parte que mas facil se rompe si se
 * toca el orden de las operaciones (redondeos por linea, no sobre el total).
 */

export interface LineaParaCalcular {
  precioUnitarioCentavos: number;
  cantidad: number;
  tarifaIva: TarifaIva;
  /** 0..100; el tope lo valida quien llama (politica del taller). */
  descuentoPorcentaje: number;
}

export interface LineaCalculada {
  /** precioUnitario * cantidad, redondeado a centavos enteros. */
  baseCentavos: number;
  descuentoCentavos: number;
  /** base - descuento. */
  baseConDescuentoCentavos: number;
  ivaCentavos: number;
  /** baseConDescuento + iva. */
  totalCentavos: number;
}

export interface TotalesOrden {
  subtotalCentavos: number;
  descuentoCentavos: number;
  ivaCentavos: number;
  totalCentavos: number;
  anticipoCentavos: number;
  /** total - anticipo, nunca negativo (un anticipo no cubre de mas). */
  saldoCentavos: number;
}

/**
 * El descuento se calcula sobre `base` (precio x cantidad) ANTES del IVA:
 * es un descuento comercial, no una rebaja de impuesto. El IVA se calcula
 * sobre lo que queda despues de descontar (asi lo pide la DIAN: el IVA es
 * sobre el valor efectivamente cobrado).
 */
export function calcularLinea(
  linea: LineaParaCalcular,
  responsableIva: boolean,
): LineaCalculada {
  if (linea.cantidad <= 0) {
    throw new RangeError(`La cantidad tiene que ser positiva; llego ${linea.cantidad}`);
  }
  if (linea.descuentoPorcentaje < 0 || linea.descuentoPorcentaje > 100) {
    throw new RangeError(
      `El descuento tiene que estar entre 0 y 100; llego ${linea.descuentoPorcentaje}`,
    );
  }
  const baseCentavos = Math.round(linea.precioUnitarioCentavos * linea.cantidad);
  const descuentoCentavos = porcentajeRedondeado(baseCentavos, linea.descuentoPorcentaje);
  const baseConDescuentoCentavos = baseCentavos - descuentoCentavos;
  const ivaCentavos = responsableIva
    ? porcentajeRedondeado(baseConDescuentoCentavos, linea.tarifaIva)
    : 0;
  return {
    baseCentavos,
    descuentoCentavos,
    baseConDescuentoCentavos,
    ivaCentavos,
    totalCentavos: baseConDescuentoCentavos + ivaCentavos,
  };
}

/**
 * Suma las lineas ya calculadas y descuenta lo que el cliente ya haya
 * pagado (el anticipo del turno, Sprint 24). El saldo nunca es negativo:
 * un anticipo mayor al total no genera un "saldo a favor" aca (eso, si
 * hiciera falta, es una devolucion aparte).
 */
export function calcularTotalesOrden(
  lineas: LineaCalculada[],
  anticipoCentavos: number,
): TotalesOrden {
  const subtotalCentavos = lineas.reduce((s, l) => s + l.baseCentavos, 0);
  const descuentoCentavos = lineas.reduce((s, l) => s + l.descuentoCentavos, 0);
  const ivaCentavos = lineas.reduce((s, l) => s + l.ivaCentavos, 0);
  const totalCentavos = lineas.reduce((s, l) => s + l.totalCentavos, 0);
  return {
    subtotalCentavos,
    descuentoCentavos,
    ivaCentavos,
    totalCentavos,
    anticipoCentavos,
    saldoCentavos: Math.max(0, totalCentavos - anticipoCentavos),
  };
}

/** 409/400 segun quien llame: valida contra el tope de descuento del taller. */
export function descuentoDentroDelTope(
  descuentoPorcentaje: number,
  topeMaximoPorcentaje: number,
): boolean {
  return descuentoPorcentaje <= topeMaximoPorcentaje;
}

export interface LineaParaCotizacion {
  descripcion: string;
  cantidad: number;
  totalCentavos: number;
}

/**
 * Texto plano de la cotizacion (punto 4 del Sprint 26): lo que se manda por
 * correo con la orden en borrador, antes de ejecutar el trabajo.
 */
export function textoCotizacion(args: {
  tallerNombre: string;
  numero: number;
  clienteNombre: string;
  lineas: LineaParaCotizacion[];
  totales: TotalesOrden;
  enlace: string;
}): { asunto: string; mensaje: string } {
  const { tallerNombre, numero, clienteNombre, lineas, totales, enlace } = args;
  const detalle = lineas
    .map((l) => `- ${l.descripcion} x${l.cantidad}: ${formatearPesos(l.totalCentavos)}`)
    .join('\n');
  const lineasAnticipo =
    totales.anticipoCentavos > 0
      ? `\nYa pagado (anticipo): ${formatearPesos(totales.anticipoCentavos)}\nSaldo: ${formatearPesos(totales.saldoCentavos)}`
      : '';
  const mensaje =
    `Hola ${clienteNombre}:\n\n` +
    `${tallerNombre} te envia la cotizacion N.° ${numero} para tu aprobacion:\n\n` +
    `${detalle}\n\n` +
    `Descuento: ${formatearPesos(totales.descuentoCentavos)}\n` +
    `Total: ${formatearPesos(totales.totalCentavos)}${lineasAnticipo}\n\n` +
    `El taller no va a empezar el trabajo hasta que la aceptes. Podes revisarla y ` +
    `aceptarla desde tu cuenta en:\n${enlace}\n\n` +
    'Si no la esperabas, escribile al taller antes de aceptarla.';
  return { asunto: `Cotizacion N.° ${numero} de ${tallerNombre}`, mensaje };
}
