import { formatearPesos } from '../../common/dinero.util';
import {
  calcularLinea,
  calcularTotalesOrden,
  descuentoDentroDelTope,
  textoCotizacion,
  type LineaCalculada,
} from './orden-venta.util';

describe('calcularLinea', () => {
  it('sin descuento, con IVA: base + IVA sobre la base entera', () => {
    // $80.000 x 1, 19%, responsable de IVA.
    expect(
      calcularLinea(
        { precioUnitarioCentavos: 8_000_000, cantidad: 1, tarifaIva: 19, descuentoPorcentaje: 0 },
        true,
      ),
    ).toEqual({
      baseCentavos: 8_000_000,
      descuentoCentavos: 0,
      baseConDescuentoCentavos: 8_000_000,
      ivaCentavos: 1_520_000,
      totalCentavos: 9_520_000,
    });
  });

  it('el descuento se aplica sobre la base, y el IVA sobre lo que queda', () => {
    // $80.000 x 1, 20% de descuento -> base con descuento $64.000; IVA 19% de eso.
    const l = calcularLinea(
      { precioUnitarioCentavos: 8_000_000, cantidad: 1, tarifaIva: 19, descuentoPorcentaje: 20 },
      true,
    );
    expect(l.descuentoCentavos).toBe(1_600_000);
    expect(l.baseConDescuentoCentavos).toBe(6_400_000);
    expect(l.ivaCentavos).toBe(1_216_000);
    expect(l.totalCentavos).toBe(7_616_000);
  });

  it('cantidad mayor que 1 multiplica la base', () => {
    const l = calcularLinea(
      { precioUnitarioCentavos: 1_500_000, cantidad: 3, tarifaIva: 19, descuentoPorcentaje: 0 },
      false,
    );
    expect(l.baseCentavos).toBe(4_500_000);
    expect(l.totalCentavos).toBe(4_500_000);
  });

  it('taller no responsable de IVA: no suma IVA aunque la tarifa no sea 0', () => {
    const l = calcularLinea(
      { precioUnitarioCentavos: 1_000_000, cantidad: 1, tarifaIva: 19, descuentoPorcentaje: 0 },
      false,
    );
    expect(l.ivaCentavos).toBe(0);
    expect(l.totalCentavos).toBe(1_000_000);
  });

  it('rechaza cantidad o descuento fuera de rango', () => {
    const base = { precioUnitarioCentavos: 100, cantidad: 1, tarifaIva: 19 as const, descuentoPorcentaje: 0 };
    expect(() => calcularLinea({ ...base, cantidad: 0 }, true)).toThrow(RangeError);
    expect(() => calcularLinea({ ...base, descuentoPorcentaje: 101 }, true)).toThrow(RangeError);
    expect(() => calcularLinea({ ...base, descuentoPorcentaje: -1 }, true)).toThrow(RangeError);
  });
});

describe('calcularTotalesOrden', () => {
  const linea = (over: Partial<LineaCalculada>): LineaCalculada => ({
    baseCentavos: 0,
    descuentoCentavos: 0,
    baseConDescuentoCentavos: 0,
    ivaCentavos: 0,
    totalCentavos: 0,
    ...over,
  });

  it('suma las lineas y resta el anticipo del total', () => {
    const totales = calcularTotalesOrden(
      [
        linea({ baseCentavos: 8_000_000, descuentoCentavos: 0, ivaCentavos: 1_520_000, totalCentavos: 9_520_000 }),
        linea({ baseCentavos: 2_500_000, descuentoCentavos: 500_000, ivaCentavos: 380_000, totalCentavos: 2_380_000 }),
      ],
      2_000_000,
    );
    expect(totales).toEqual({
      subtotalCentavos: 10_500_000,
      descuentoCentavos: 500_000,
      ivaCentavos: 1_900_000,
      totalCentavos: 11_900_000,
      anticipoCentavos: 2_000_000,
      saldoCentavos: 9_900_000,
    });
  });

  it('el saldo nunca es negativo, aunque el anticipo supere el total', () => {
    const totales = calcularTotalesOrden(
      [linea({ baseCentavos: 100, totalCentavos: 100 })],
      1_000_000,
    );
    expect(totales.saldoCentavos).toBe(0);
  });

  it('sin lineas, todo en cero (y sin dividir por nada)', () => {
    expect(calcularTotalesOrden([], 0)).toEqual({
      subtotalCentavos: 0,
      descuentoCentavos: 0,
      ivaCentavos: 0,
      totalCentavos: 0,
      anticipoCentavos: 0,
      saldoCentavos: 0,
    });
  });
});

describe('descuentoDentroDelTope', () => {
  it('permite hasta el tope, inclusive', () => {
    expect(descuentoDentroDelTope(20, 20)).toBe(true);
    expect(descuentoDentroDelTope(21, 20)).toBe(false);
  });

  it('con tope 0 (default), ningun descuento pasa', () => {
    expect(descuentoDentroDelTope(1, 0)).toBe(false);
    expect(descuentoDentroDelTope(0, 0)).toBe(true);
  });
});

describe('textoCotizacion', () => {
  it('detalla las lineas, el descuento, el total y el enlace', () => {
    const { asunto, mensaje } = textoCotizacion({
      tallerNombre: 'Taller Centro',
      numero: 7,
      clienteNombre: 'Maria Gomez',
      lineas: [
        { descripcion: 'Cambio de aceite', cantidad: 1, totalCentavos: 9_520_000 },
        { descripcion: 'Filtro de aceite', cantidad: 2, totalCentavos: 5_950_000 },
      ],
      totales: {
        subtotalCentavos: 15_500_000,
        descuentoCentavos: 500_000,
        ivaCentavos: 2_470_000,
        totalCentavos: 15_470_000,
        anticipoCentavos: 0,
        saldoCentavos: 15_470_000,
      },
      enlace: 'https://turnos.dev/ventas/abc-123',
    });
    expect(asunto).toBe('Cotizacion N.° 7 de Taller Centro');
    expect(mensaje).toContain('Maria Gomez');
    expect(mensaje).toContain(`Cambio de aceite x1: ${formatearPesos(9_520_000)}`);
    expect(mensaje).toContain(`Filtro de aceite x2: ${formatearPesos(5_950_000)}`);
    expect(mensaje).toContain(`Descuento: ${formatearPesos(500_000)}`);
    expect(mensaje).toContain(`Total: ${formatearPesos(15_470_000)}`);
    expect(mensaje).toContain('https://turnos.dev/ventas/abc-123');
    expect(mensaje).not.toContain('anticipo');
  });

  it('con anticipo ya pagado, muestra lo pagado y el saldo', () => {
    const { mensaje } = textoCotizacion({
      tallerNombre: 'Taller Centro',
      numero: 8,
      clienteNombre: 'Jorge Ruiz',
      lineas: [{ descripcion: 'Latoneria', cantidad: 1, totalCentavos: 25_000_000 }],
      totales: {
        subtotalCentavos: 25_000_000,
        descuentoCentavos: 0,
        ivaCentavos: 0,
        totalCentavos: 25_000_000,
        anticipoCentavos: 5_000_000,
        saldoCentavos: 20_000_000,
      },
      enlace: 'https://turnos.dev/ventas/xyz',
    });
    expect(mensaje).toContain(`Ya pagado (anticipo): ${formatearPesos(5_000_000)}`);
    expect(mensaje).toContain(`Saldo: ${formatearPesos(20_000_000)}`);
  });
});
