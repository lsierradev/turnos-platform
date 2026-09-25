import { domingoDePascua, festivosDeColombia } from './festivos-colombia.util';
import { digitoVerificacion, normalizarNit } from './nit.util';

describe('digito de verificacion del NIT', () => {
  it.each([
    ['800197268', 4], // DIAN
    ['890903938', 8], // Bancolombia
    ['899999068', 1], // Ecopetrol
    ['860034313', 7], // Davivienda
  ])('NIT %s -> DV %i', (nit, dv) => {
    expect(digitoVerificacion(nit)).toBe(dv);
  });

  it('quita puntos, espacios y el DV que venga pegado', () => {
    expect(normalizarNit('800.197.268-4')).toBe('800197268');
    expect(normalizarNit(' 800 197 268 ')).toBe('800197268');
  });

  it('rechaza lo que no son digitos', () => {
    expect(() => digitoVerificacion('80019726A')).toThrow(RangeError);
  });
});

describe('festivos de Colombia', () => {
  it('domingo de Pascua', () => {
    expect(domingoDePascua(2025)).toBe('2025-04-20');
    expect(domingoDePascua(2026)).toBe('2026-04-05');
    expect(domingoDePascua(2027)).toBe('2027-03-28');
  });

  it('2026: los 18 festivos, con Ley Emiliani y los de Pascua', () => {
    const f = festivosDeColombia(2026);
    expect(f).toHaveLength(18);
    const fechas = Object.fromEntries(f.map((x) => [x.motivo, x.fecha]));
    expect(fechas).toMatchObject({
      'Año Nuevo': '2026-01-01',
      // 6 de enero de 2026 es martes -> lunes 12.
      'Día de los Reyes Magos': '2026-01-12',
      // 19 de marzo es jueves -> lunes 23.
      'Día de San José': '2026-03-23',
      'Jueves Santo': '2026-04-02',
      'Viernes Santo': '2026-04-03',
      'Ascensión del Señor': '2026-05-18',
      'Corpus Christi': '2026-06-08',
      'Sagrado Corazón': '2026-06-15',
      // 29 de junio de 2026 ya es lunes: se queda.
      'San Pedro y San Pablo': '2026-06-29',
      'Día de la Independencia': '2026-07-20',
      'Batalla de Boyacá': '2026-08-07',
      'Asunción de la Virgen': '2026-08-17',
      'Día de la Raza': '2026-10-12',
      'Todos los Santos': '2026-11-02',
      'Independencia de Cartagena': '2026-11-16',
      'Inmaculada Concepción': '2026-12-08',
      Navidad: '2026-12-25',
    });
  });

  it('vienen ordenados por fecha', () => {
    const fechas = festivosDeColombia(2027).map((f) => f.fecha);
    expect([...fechas].sort()).toEqual(fechas);
  });
});
