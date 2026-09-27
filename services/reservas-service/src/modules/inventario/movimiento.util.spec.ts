import {
  admiteTurno,
  calcularCantidadConSigno,
  esCompra,
} from './movimiento.util';

describe('calcularCantidadConSigno', () => {
  it('entrada y devolucion suman', () => {
    expect(calcularCantidadConSigno('entrada', 5)).toBe(5);
    expect(calcularCantidadConSigno('devolucion', 2.5)).toBe(2.5);
  });

  it('salida siempre resta', () => {
    expect(calcularCantidadConSigno('salida', 3)).toBe(-3);
  });

  it('ajuste depende del sentido', () => {
    expect(calcularCantidadConSigno('ajuste', 4, 'incremento')).toBe(4);
    expect(calcularCantidadConSigno('ajuste', 4, 'decremento')).toBe(-4);
  });

  it('un ajuste sin sentido es un error de programacion, no un 500 silencioso', () => {
    expect(() => calcularCantidadConSigno('ajuste', 4)).toThrow(/sentido/);
  });

  it('rechaza una cantidad que no es positiva', () => {
    expect(() => calcularCantidadConSigno('entrada', 0)).toThrow(RangeError);
    expect(() => calcularCantidadConSigno('salida', -1)).toThrow(RangeError);
  });
});

describe('esCompra / admiteTurno', () => {
  it('solo la entrada es una compra', () => {
    expect(esCompra('entrada')).toBe(true);
    expect(esCompra('salida')).toBe(false);
    expect(esCompra('ajuste')).toBe(false);
    expect(esCompra('devolucion')).toBe(false);
  });

  it('solo la salida se puede atar a un turno', () => {
    expect(admiteTurno('salida')).toBe(true);
    expect(admiteTurno('entrada')).toBe(false);
    expect(admiteTurno('ajuste')).toBe(false);
    expect(admiteTurno('devolucion')).toBe(false);
  });
});
