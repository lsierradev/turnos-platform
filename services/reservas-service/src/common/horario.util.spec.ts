import {
  diaDelTaller,
  diaSemanaIso,
  horaAMinutos,
  horarioPorDefecto,
  limitesDelDia,
  minutosAHora,
  proximosDiasAbiertos,
  type HorarioTaller,
} from './horario.util';

/** Lunes a viernes 08:00-17:30, sabado 08:00-12:00, domingo cerrado. */
function horarioSemana(feriados: [string, string][] = []): HorarioTaller {
  const semana = new Map();
  for (let d = 1; d <= 5; d += 1)
    semana.set(d, { apertura: 480, cierre: 1050 });
  semana.set(6, { apertura: 480, cierre: 720 });
  return { semana, feriados: new Map(feriados) };
}

describe('horario.util', () => {
  it('dia ISO de una fecha calendario (1 = lunes, 7 = domingo)', () => {
    expect(diaSemanaIso('2026-09-21')).toBe(1); // lunes
    expect(diaSemanaIso('2026-09-26')).toBe(6); // sabado
    expect(diaSemanaIso('2026-09-27')).toBe(7); // domingo
  });

  it('el horario por defecto es el historico: todos los dias 08-18', () => {
    const h = horarioPorDefecto();
    expect(diaDelTaller(h, '2026-09-27')).toEqual({
      abierto: true,
      jornada: { apertura: 480, cierre: 1080 },
    });
  });

  it('un dia sin fila esta cerrado', () => {
    expect(diaDelTaller(horarioSemana(), '2026-09-27')).toEqual({
      abierto: false,
      motivo: 'Cerrado',
    });
  });

  it('un festivo cierra aunque el dia de la semana atienda, con su motivo', () => {
    const h = horarioSemana([['2026-10-12', 'Día de la Raza']]);
    expect(diaDelTaller(h, '2026-10-12')).toEqual({
      abierto: false,
      motivo: 'Día de la Raza',
    });
  });

  it('convierte horas y minutos en los dos sentidos', () => {
    expect(horaAMinutos('17:30')).toBe(1050);
    expect(minutosAHora(1050)).toBe('17:30');
    expect(minutosAHora(480)).toBe('08:00');
  });

  it('limites del dia en la zona del taller (Bogota, UTC-5)', () => {
    const { apertura, cierre } = limitesDelDia(
      '2026-09-21',
      { apertura: 480, cierre: 1050 },
      'America/Bogota',
    );
    expect(apertura.toISOString()).toBe('2026-09-21T13:00:00.000Z');
    expect(cierre.toISOString()).toBe('2026-09-21T22:30:00.000Z');
  });

  it('proximos dias abiertos saltea domingo y festivos', () => {
    // Sabado 10/10, domingo 11 cerrado, lunes 12 festivo, martes 13.
    const h = horarioSemana([['2026-10-12', 'Día de la Raza']]);
    expect(
      proximosDiasAbiertos(h, '2026-10-10', 3).map((d) => d.fecha),
    ).toEqual(['2026-10-10', '2026-10-13', '2026-10-14']);
  });

  it('un taller cerrado corta la busqueda en el tope de dias', () => {
    const cerrado: HorarioTaller = { semana: new Map(), feriados: new Map() };
    expect(proximosDiasAbiertos(cerrado, '2026-10-10', 3)).toEqual([]);
  });
});
