import { calcularOcupacion, esAlerta, nivelOcupacion } from './ocupacion.util';

describe('ocupacion.util', () => {
  it('mide contra la jornada del dia (8 a 18 = 600 min), no contra 24 h', () => {
    expect(calcularOcupacion(300, 600)).toBe(0.5);
  });

  it('con otra jornada (Sprint 21: horario por taller) cambia la base', () => {
    // Sabado de 08:00 a 12:00: 240 min.
    expect(calcularOcupacion(120, 240)).toBe(0.5);
  });

  it('un dia cerrado (jornada 0) no divide por cero', () => {
    expect(calcularOcupacion(60, 0)).toBe(0);
  });

  it('redondea a 3 decimales', () => {
    expect(calcularOcupacion(200, 600)).toBe(0.333);
  });

  it('no pasa de 100% ni baja de 0%', () => {
    expect(calcularOcupacion(900, 600)).toBe(1);
    expect(calcularOcupacion(-10, 600)).toBe(0);
  });

  describe('nivelOcupacion', () => {
    it('sin turnos es libre', () => {
      expect(nivelOcupacion(0, 0)).toBe('libre');
    });

    it('por debajo del 80% es normal', () => {
      expect(nivelOcupacion(0.79, 3)).toBe('normal');
    });

    it('desde el 80% es alta (justo en el borde)', () => {
      expect(nivelOcupacion(0.8, 5)).toBe('alta');
    });

    it('al 100% es completa', () => {
      expect(nivelOcupacion(1, 8)).toBe('completa');
    });

    it('un turno muy corto no es "libre" aunque la ocupacion redondee a 0', () => {
      expect(nivelOcupacion(0, 1)).toBe('normal');
    });
  });

  it('alerta solo en alta y completa', () => {
    expect(esAlerta('alta')).toBe(true);
    expect(esAlerta('completa')).toBe(true);
    expect(esAlerta('normal')).toBe(false);
    expect(esAlerta('libre')).toBe(false);
  });
});
