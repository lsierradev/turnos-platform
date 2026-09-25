import type { Precio } from './api-client';

// Pesos enteros sin decimales; con centavos, siempre dos ("$ 119.999,60",
// nunca "$ 119.999,6").
const PESOS = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});
const PESOS_CON_CENTAVOS = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 8000000 -> "$ 80.000" (el backend maneja centavos enteros). */
export function formatearPesos(centavos: number): string {
  return (centavos % 100 === 0 ? PESOS : PESOS_CON_CENTAVOS).format(centavos / 100);
}

/**
 * Precio final como lo ve el cliente (Ley 1480, art. 26): siempre el total,
 * con "IVA incluido" si el taller cobra IVA. Si no es responsable, el
 * precio va solo, sin leyenda.
 */
export function textoPrecioFinal(precio: Precio): string {
  const total = formatearPesos(precio.totalCentavos);
  return precio.tarifaIva === null ? total : `${total} IVA incluido`;
}

/** "Subtotal $ 80.000 + IVA 19% $ 15.200", o null si no lleva IVA. */
export function textoDesglose(precio: Precio): string | null {
  if (precio.tarifaIva === null) return null;
  return `Subtotal ${formatearPesos(precio.baseCentavos)} + IVA ${precio.tarifaIva}% ${formatearPesos(precio.ivaCentavos)}`;
}

/** "80.000" o "80.000,5" -> centavos; null si no es un monto valido. */
export function pesosACentavos(texto: string): number | null {
  const limpio = texto.trim().replace(/[$\s]/g, '').replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null;
  return Math.round(Number(limpio) * 100);
}

/**
 * Vista previa del precio mientras el admin edita. MISMA regla que el
 * backend (reservas-service, common/precios.util.ts): IVA sobre la base,
 * redondeado al centavo mitad hacia arriba, en enteros. Lo que se guarda
 * igual lo calcula el servidor; esto solo tiene que coincidir con lo que
 * va a mostrar.
 */
export function calcularPrecio(
  baseCentavos: number,
  tarifaIva: number,
  responsableIva: boolean,
): Precio {
  if (!responsableIva) {
    return { baseCentavos, ivaCentavos: 0, totalCentavos: baseCentavos, tarifaIva: null };
  }
  const ivaCentavos = Math.floor((baseCentavos * tarifaIva + 50) / 100);
  return { baseCentavos, ivaCentavos, totalCentavos: baseCentavos + ivaCentavos, tarifaIva };
}

/**
 * Base que da (lo mas cerca posible) un total con IVA: para cargar el
 * precio "como lo cobra" el taller. Por el redondeo, el total resultante
 * puede diferir en un centavo; la pantalla muestra el que queda.
 */
export function baseDesdeTotal(totalCentavos: number, tarifaIva: number): number {
  return Math.round((totalCentavos * 100) / (100 + tarifaIva));
}
