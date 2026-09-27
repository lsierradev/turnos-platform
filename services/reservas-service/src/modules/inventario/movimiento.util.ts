import type { TipoMovimiento } from './dto/inventario.dto';

/**
 * El signo de un movimiento de kardex (Sprint 25). Aislado del servicio
 * para poder probarlo sin base de datos: es la regla que decide si un
 * movimiento suma o resta stock, y es facil de romper por accidente al
 * tocar el DTO o el formulario.
 *
 * `cantidad` siempre llega positiva (el formulario no pide "escribi un
 * numero negativo para restar"): entrada y devolucion suman tal cual;
 * salida siempre resta; ajuste depende de `sentido`, porque un ajuste
 * corrige el stock en cualquier direccion.
 *
 * El CHECK movimientos_inventario_signo (migracion 020) es quien de verdad
 * lo garantiza -- esto es para no depender de que la base rechace un
 * calculo que ya sabiamos que estaba mal antes de mandarlo.
 */
export function calcularCantidadConSigno(
  tipo: TipoMovimiento,
  cantidad: number,
  sentido?: 'incremento' | 'decremento',
): number {
  if (cantidad <= 0) {
    throw new RangeError(
      `La cantidad tiene que ser positiva; llego ${cantidad}`,
    );
  }
  switch (tipo) {
    case 'entrada':
    case 'devolucion':
      return cantidad;
    case 'salida':
      return -cantidad;
    case 'ajuste':
      if (sentido !== 'incremento' && sentido !== 'decremento') {
        throw new RangeError(
          'Un ajuste necesita sentido: incremento o decremento',
        );
      }
      return sentido === 'decremento' ? -cantidad : cantidad;
  }
}

/** Los tipos que llevan proveedor y costo (una compra). */
export function esCompra(tipo: TipoMovimiento): boolean {
  return tipo === 'entrada';
}

/** Los tipos que se pueden atar a un turno (repuestos usados en la orden). */
export function admiteTurno(tipo: TipoMovimiento): boolean {
  return tipo === 'salida';
}
