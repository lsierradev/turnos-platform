/**
 * Precios con IVA (Sprint 21). Todo en centavos enteros y con UNA sola
 * regla de redondeo, esta: si el total que ve el cliente, el que cobra
 * Wompi y el de la factura se calcularan en lugares distintos, tarde o
 * temprano difieren en un peso.
 *
 * Regla: el IVA se calcula sobre la base y se redondea al centavo, mitad
 * hacia arriba. Aritmetica entera: nada de base * 0.19 en punto flotante
 * (0.19 no es representable y 1050 * 0.19 da 199.49999...).
 */

/** Tarifas de IVA vigentes en Colombia (general, reducida, exento). */
export const TARIFAS_IVA = [0, 5, 19] as const;
export type TarifaIva = (typeof TARIFAS_IVA)[number];

/** Anticipo permitido por la politica de cancelacion, en %. */
export const ANTICIPO_MINIMO = 15;
export const ANTICIPO_MAXIMO = 20;

export interface Precio {
  baseCentavos: number;
  ivaCentavos: number;
  totalCentavos: number;
  /** null: el taller no es responsable de IVA (no se suma ni se muestra). */
  tarifaIva: TarifaIva | null;
}

/** round(valor * porcentaje / 100), mitad hacia arriba, en enteros. */
export function porcentajeRedondeado(
  valor: number,
  porcentaje: number,
): number {
  if (!Number.isSafeInteger(valor) || valor < 0) {
    throw new RangeError(`Monto en centavos invalido: ${valor}`);
  }
  return Math.floor((valor * porcentaje + 50) / 100);
}

export function calcularPrecio(
  baseCentavos: number,
  tarifaIva: TarifaIva,
  responsableIva: boolean,
): Precio {
  if (!responsableIva) {
    return {
      baseCentavos,
      ivaCentavos: 0,
      totalCentavos: baseCentavos,
      tarifaIva: null,
    };
  }
  const ivaCentavos = porcentajeRedondeado(baseCentavos, tarifaIva);
  return {
    baseCentavos,
    ivaCentavos,
    totalCentavos: baseCentavos + ivaCentavos,
    tarifaIva,
  };
}

/** Anticipo sobre el TOTAL (lo que paga el cliente, IVA incluido). */
export function calcularAnticipo(
  totalCentavos: number,
  porcentaje: number | null,
): number | null {
  return porcentaje === null
    ? null
    : porcentajeRedondeado(totalCentavos, porcentaje);
}
