import {
  fechaDeNegocio,
  fechaEnZona,
  horaEnZona,
  inicioDelDiaEnZona,
  instanteEnZona,
  partesEnZona,
  sumarDiasFecha,
  zonaHorariaNegocio,
} from './zona-horaria.util';

const BOGOTA = 'America/Bogota';

describe('zona-horaria.util', () => {
  const zonaOriginal = process.env.TZ_NEGOCIO;

  afterEach(() => {
    if (zonaOriginal === undefined) {
      delete process.env.TZ_NEGOCIO;
    } else {
      process.env.TZ_NEGOCIO = zonaOriginal;
    }
    jest.useRealTimers();
  });

  describe('zonaHorariaNegocio', () => {
    it('usa America/Bogota por defecto', () => {
      delete process.env.TZ_NEGOCIO;
      expect(zonaHorariaNegocio()).toBe(BOGOTA);
    });

    it('trata el string vacio como no configurado', () => {
      process.env.TZ_NEGOCIO = '  ';
      expect(zonaHorariaNegocio()).toBe(BOGOTA);
    });

    it('respeta la zona configurada', () => {
      process.env.TZ_NEGOCIO = 'Europe/Madrid';
      expect(zonaHorariaNegocio()).toBe('Europe/Madrid');
    });

    it('falla fuerte con una zona invalida en vez de caer a UTC', () => {
      process.env.TZ_NEGOCIO = 'America/Bogata';
      expect(() => zonaHorariaNegocio()).toThrow(/TZ_NEGOCIO/);
    });
  });

  describe('fechaEnZona / horaEnZona cerca de medianoche', () => {
    it('23:59 de Bogota sigue siendo el mismo dia aunque en UTC ya sea el siguiente', () => {
      const instante = new Date('2024-01-09T04:59:00.000Z');
      expect(fechaEnZona(instante, BOGOTA)).toBe('2024-01-08');
      expect(horaEnZona(instante, BOGOTA)).toBe('23:59');
    });

    it('00:00 de Bogota ya es el dia siguiente', () => {
      const instante = new Date('2024-01-09T05:00:00.000Z');
      expect(fechaEnZona(instante, BOGOTA)).toBe('2024-01-09');
      expect(horaEnZona(instante, BOGOTA)).toBe('00:00');
    });

    it('la medianoche sale como 00, nunca como 24', () => {
      const { hora } = partesEnZona(
        new Date('2024-01-09T05:00:00.000Z'),
        BOGOTA,
      );
      expect(hora).toBe(0);
    });

    it('cruza fin de mes y de anio', () => {
      // 31/12 23:30 en Bogota = 01/01 04:30Z.
      expect(fechaEnZona(new Date('2025-01-01T04:30:00.000Z'), BOGOTA)).toBe(
        '2024-12-31',
      );
    });
  });

  describe('instanteEnZona', () => {
    it('convierte hora de pared de Bogota a UTC', () => {
      expect(instanteEnZona('2024-01-08', 14, 0, BOGOTA)).toEqual(
        new Date('2024-01-08T19:00:00.000Z'),
      );
    });

    it('la medianoche local de Bogota es las 05:00Z', () => {
      expect(inicioDelDiaEnZona('2024-01-08', BOGOTA)).toEqual(
        new Date('2024-01-08T05:00:00.000Z'),
      );
    });

    it('en una zona con offset positivo la medianoche local cae el dia UTC anterior', () => {
      expect(inicioDelDiaEnZona('2024-01-08', 'Asia/Tokyo')).toEqual(
        new Date('2024-01-07T15:00:00.000Z'),
      );
    });

    it('usa el offset correcto a cada lado de un cambio de horario de verano', () => {
      // Nueva York: 10/03/2024 a las 02:00 salta a 03:00 (EST -5 -> EDT -4).
      const zona = 'America/New_York';
      expect(instanteEnZona('2024-03-10', 1, 0, zona)).toEqual(
        new Date('2024-03-10T06:00:00.000Z'),
      );
      expect(instanteEnZona('2024-03-10', 4, 0, zona)).toEqual(
        new Date('2024-03-10T08:00:00.000Z'),
      );
    });

    it('es la inversa de partesEnZona', () => {
      const instante = instanteEnZona('2024-06-15', 8, 45, BOGOTA);
      expect(partesEnZona(instante, BOGOTA)).toMatchObject({
        anio: 2024,
        mes: 6,
        dia: 15,
        hora: 8,
        minuto: 45,
      });
    });
  });

  describe('sumarDiasFecha', () => {
    it('suma y resta dias de calendario cruzando meses y anios', () => {
      expect(sumarDiasFecha('2024-12-31', 1)).toBe('2025-01-01');
      expect(sumarDiasFecha('2024-03-01', -1)).toBe('2024-02-29');
    });
  });

  describe('fechaDeNegocio', () => {
    it('toma YYYY-MM-DD tal cual, sin pasarlo por medianoche UTC', () => {
      expect(fechaDeNegocio('2024-01-08', BOGOTA)).toBe('2024-01-08');
    });

    it('ubica un instante completo en el dia de negocio en que cae', () => {
      expect(fechaDeNegocio('2024-01-09T02:00:00.000Z', BOGOTA)).toBe(
        '2024-01-08',
      );
    });

    it('sin valor devuelve hoy en la zona de negocio, no en UTC', () => {
      jest.useFakeTimers({ now: new Date('2024-01-09T03:00:00.000Z') });
      // 03:00Z del 9 = 22:00 del 8 en Bogota.
      expect(fechaDeNegocio(undefined, BOGOTA)).toBe('2024-01-08');
    });
  });
});
