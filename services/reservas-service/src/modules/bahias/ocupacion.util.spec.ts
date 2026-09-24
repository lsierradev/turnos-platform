import {
  calcularOcupacion,
  esAlerta,
  horaSql,
  JORNADA,
  nivelOcupacion,
} from './ocupacion.util';

describe('ocupacion.util', () => {
  it('mide contra la jornada laboral (8 a 18 = 600 min), no contra 24 h', () => {
    expect(JORNADA.minutos).toBe(600);
    expect(calcularOcupacion(300)).toBe(0.5);
  });

  it('redondea a 3 decimales', () => {
    expect(calcularOcupacion(200)).toBe(0.333);
  });

  it('no pasa de 100% ni baja de 0%', () => {
    expect(calcularOcupacion(900)).toBe(1);
    expect(calcularOcupacion(-10)).toBe(0);
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

  it('formatea horas para parametros SQL de tipo time', () => {
    expect(horaSql(8)).toBe('08:00');
    expect(horaSql(18)).toBe('18:00');
  });
});
