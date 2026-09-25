import {
  evaluarCancelacion,
  formatearAnticipacion,
} from './politica-cancelacion.util';

const BOGOTA = 'America/Bogota';
const MIN = 60_000;

describe('evaluarCancelacion (Sprint 22)', () => {
  // Turno a las 10:00 de Bogota = 15:00 UTC.
  const inicioTurno = new Date('2026-09-30T10:00:00-05:00');
  const evaluar = (ahora: Date, ventanaHoras = 4, zona = BOGOTA) =>
    evaluarCancelacion({ inicioTurno, ahora, ventanaHoras, zona });

  it('4 h 01 min antes: gratis', () => {
    const r = evaluar(new Date(inicioTurno.getTime() - (4 * 60 + 1) * MIN));
    expect(r.gratis).toBe(true);
    expect(r.anticipacionMinutos).toBe(241);
  });

  it('3 h 59 min antes: strike', () => {
    const r = evaluar(new Date(inicioTurno.getTime() - (3 * 60 + 59) * MIN));
    expect(r.gratis).toBe(false);
    expect(r.anticipacionMinutos).toBe(239);
  });

  it('exactamente 4 h antes todavia es gratis ("hasta 4 horas antes")', () => {
    expect(evaluar(new Date(inicioTurno.getTime() - 240 * MIN)).gratis).toBe(
      true,
    );
  });

  it('un milisegundo despues del limite ya no es gratis', () => {
    expect(
      evaluar(new Date(inicioTurno.getTime() - 240 * MIN + 1)).gratis,
    ).toBe(false);
  });

  it('el limite se expresa en hora del taller (06:00 de Bogota, no 11:00 UTC)', () => {
    const r = evaluar(new Date('2026-09-29T12:00:00Z'));
    expect(r.limite.toISOString()).toBe('2026-09-30T11:00:00.000Z');
    expect(r.limiteLocal).toBe('2026-09-30 06:00');
  });

  it('el limite que cruza la medianoche cae en el dia anterior del taller', () => {
    // Turno 02:00 de Bogota; limite 22:00 del dia anterior (en UTC ya es
    // 03:00 del mismo dia del turno).
    const r = evaluarCancelacion({
      inicioTurno: new Date('2026-10-01T02:00:00-05:00'),
      ahora: new Date('2026-09-30T12:00:00-05:00'),
      ventanaHoras: 4,
      zona: BOGOTA,
    });
    expect(r.limiteLocal).toBe('2026-09-30 22:00');
  });

  it('no depende del offset con el que se expreso el instante', () => {
    const ahoraZ = new Date('2026-09-30T11:01:00Z'); // 06:01 Bogota
    const ahoraOffset = new Date('2026-09-30T06:01:00-05:00');
    const ahoraTokio = new Date('2026-09-30T20:01:00+09:00');
    for (const ahora of [ahoraZ, ahoraOffset, ahoraTokio]) {
      const r = evaluar(ahora);
      expect(r.gratis).toBe(false);
      expect(r.anticipacionMinutos).toBe(239);
    }
  });

  describe('con el proceso en otra zona horaria', () => {
    const tzOriginal = process.env.TZ;
    afterEach(() => {
      process.env.TZ = tzOriginal;
    });

    it.each(['UTC', 'Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Kiritimati'])(
      'TZ=%s: mismos bordes y mismo limite en hora del taller',
      (tz) => {
        process.env.TZ = tz;
        expect(
          evaluar(new Date(inicioTurno.getTime() - 241 * MIN)).gratis,
        ).toBe(true);
        expect(
          evaluar(new Date(inicioTurno.getTime() - 239 * MIN)).gratis,
        ).toBe(false);
        expect(evaluar(new Date('2026-09-29T12:00:00Z')).limiteLocal).toBe(
          '2026-09-30 06:00',
        );
      },
    );
  });

  it('respeta la ventana configurada por el taller', () => {
    const ahora = new Date(inicioTurno.getTime() - 10 * 60 * MIN);
    expect(evaluar(ahora, 4).gratis).toBe(true);
    expect(evaluar(ahora, 24).gratis).toBe(false);
    // Ventana 0: gratis hasta el inicio mismo.
    expect(evaluar(new Date(inicioTurno.getTime() - 1), 0).gratis).toBe(true);
    expect(evaluar(new Date(inicioTurno.getTime() + 1), 0).gratis).toBe(false);
  });
});

describe('formatearAnticipacion', () => {
  it.each([
    [239, '3 h 59 min'],
    [240, '4 h'],
    [241, '4 h 1 min'],
    [45, '45 min'],
    [-10, '0 min'],
  ])('%i -> %s', (minutos, texto) => {
    expect(formatearAnticipacion(minutos)).toBe(texto);
  });
});
