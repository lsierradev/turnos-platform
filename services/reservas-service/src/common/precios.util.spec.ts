import {
  calcularAnticipo,
  calcularPrecio,
  porcentajeRedondeado,
} from './precios.util';

describe('precios.util', () => {
  it('responsable de IVA: base + IVA = total, en centavos', () => {
    expect(calcularPrecio(8_000_000, 19, true)).toEqual({
      baseCentavos: 8_000_000,
      ivaCentavos: 1_520_000,
      totalCentavos: 9_520_000,
      tarifaIva: 19,
    });
  });

  it('no responsable: el total es la base y no hay tarifa', () => {
    expect(calcularPrecio(8_000_000, 19, false)).toEqual({
      baseCentavos: 8_000_000,
      ivaCentavos: 0,
      totalCentavos: 8_000_000,
      tarifaIva: null,
    });
  });

  it('tarifa reducida y exento', () => {
    expect(calcularPrecio(10_000, 5, true).ivaCentavos).toBe(500);
    expect(calcularPrecio(10_000, 0, true)).toMatchObject({
      ivaCentavos: 0,
      tarifaIva: 0,
    });
  });

  it('redondea al centavo mitad hacia arriba, sin errores de punto flotante', () => {
    // 1050 * 0.19 = 199.49999... en punto flotante; la regla entera da 200.
    expect(porcentajeRedondeado(1050, 19)).toBe(200);
    // 1 * 19 / 100 = 0.19 -> 0; 3 * 19 / 100 = 0.57 -> 1.
    expect(porcentajeRedondeado(1, 19)).toBe(0);
    expect(porcentajeRedondeado(3, 19)).toBe(1);
    // Exactamente .5 sube.
    expect(porcentajeRedondeado(50, 1)).toBe(1);
  });

  it('el total siempre es base + IVA exacto (lo exige la constraint de turnos)', () => {
    for (const base of [0, 1, 99, 12_345, 8_403_361, 99_999_999]) {
      const p = calcularPrecio(base, 19, true);
      expect(p.totalCentavos).toBe(p.baseCentavos + p.ivaCentavos);
    }
  });

  it('rechaza montos no enteros o negativos', () => {
    expect(() => porcentajeRedondeado(10.5, 19)).toThrow(RangeError);
    expect(() => porcentajeRedondeado(-1, 19)).toThrow(RangeError);
  });

  it('anticipo sobre el total, o null si el servicio no lo pide', () => {
    expect(calcularAnticipo(9_520_000, 20)).toBe(1_904_000);
    expect(calcularAnticipo(9_520_000, 15)).toBe(1_428_000);
    expect(calcularAnticipo(9_520_000, null)).toBeNull();
  });
});
