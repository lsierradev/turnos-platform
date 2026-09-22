import { sugerirHorarios } from './sugerencias-horarios.util';

// Lunes fijo en UTC, para que los tests no dependan del dia ni del
// timezone en que corren (el horario laboral de sugerirHorarios es UTC).
const LUNES_9AM = new Date('2024-01-08T09:00:00.000Z');

describe('sugerirHorarios', () => {
  it('sugiere exactamente el horario solicitado cuando esta libre', () => {
    const sugerencias = sugerirHorarios({
      inicioSolicitado: LUNES_9AM,
      duracionMinutos: 30,
      turnosOcupados: [],
    });

    expect(sugerencias[0]).toEqual({
      inicio: LUNES_9AM,
      fin: new Date('2024-01-08T09:30:00.000Z'),
    });
  });

  it('no sugiere horarios fuera del horario laboral (8-18 UTC por defecto)', () => {
    const sugerencias = sugerirHorarios({
      inicioSolicitado: new Date('2024-01-08T17:50:00.000Z'),
      duracionMinutos: 60,
      turnosOcupados: [],
      diasBusqueda: 1,
    });

    for (const { inicio, fin } of sugerencias) {
      expect(inicio.getUTCHours()).toBeGreaterThanOrEqual(8);
      expect(
        fin.getUTCHours() < 18 ||
          (fin.getUTCHours() === 18 && fin.getUTCMinutes() === 0),
      ).toBe(true);
    }
  });

  it('no sugiere horarios que se solapen con turnos ocupados', () => {
    const ocupado = {
      inicio: new Date('2024-01-08T09:00:00.000Z'),
      fin: new Date('2024-01-08T09:30:00.000Z'),
    };

    const sugerencias = sugerirHorarios({
      inicioSolicitado: LUNES_9AM,
      duracionMinutos: 30,
      turnosOcupados: [ocupado],
    });

    for (const rango of sugerencias) {
      const seSolapan =
        rango.inicio < ocupado.fin && ocupado.inicio < rango.fin;
      expect(seSolapan).toBe(false);
    }
  });

  it('ordena por cercania al horario solicitado', () => {
    const ocupado = {
      inicio: new Date('2024-01-08T09:00:00.000Z'),
      fin: new Date('2024-01-08T09:30:00.000Z'),
    };

    const [primera, segunda] = sugerirHorarios({
      inicioSolicitado: LUNES_9AM,
      duracionMinutos: 30,
      turnosOcupados: [ocupado],
      cantidad: 2,
    });

    const distancia = (r: { inicio: Date }) =>
      Math.abs(r.inicio.getTime() - LUNES_9AM.getTime());

    expect(distancia(primera)).toBeLessThanOrEqual(distancia(segunda));
  });

  it('respeta la cantidad pedida', () => {
    const sugerencias = sugerirHorarios({
      inicioSolicitado: LUNES_9AM,
      duracionMinutos: 30,
      turnosOcupados: [],
      cantidad: 1,
    });

    expect(sugerencias).toHaveLength(1);
  });

  it('devuelve arreglo vacio si no hay huecos libres en toda la ventana', () => {
    const ocupadoTodoElDia = {
      inicio: new Date('2024-01-08T00:00:00.000Z'),
      fin: new Date('2024-01-11T00:00:00.000Z'),
    };

    const sugerencias = sugerirHorarios({
      inicioSolicitado: LUNES_9AM,
      duracionMinutos: 30,
      turnosOcupados: [ocupadoTodoElDia],
      diasBusqueda: 3,
    });

    expect(sugerencias).toEqual([]);
  });
});
