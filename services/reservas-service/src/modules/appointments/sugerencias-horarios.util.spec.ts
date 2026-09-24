import { fechaEnZona, partesEnZona } from '../../common/zona-horaria.util';
import { sugerirHorarios } from './sugerencias-horarios.util';

// Lunes fijo con offset explicito, para que los tests no dependan del dia
// ni de la zona del proceso. El horario laboral de sugerirHorarios es el de
// la zona de negocio (default America/Bogota, UTC-5 sin horario de verano).
const BOGOTA = 'America/Bogota';
const LUNES_9AM = new Date('2024-01-08T09:00:00-05:00');

describe('sugerirHorarios', () => {
  it('sugiere exactamente el horario solicitado cuando esta libre', () => {
    const sugerencias = sugerirHorarios({
      inicioSolicitado: LUNES_9AM,
      duracionMinutos: 30,
      turnosOcupados: [],
    });

    expect(sugerencias[0]).toEqual({
      inicio: LUNES_9AM,
      fin: new Date('2024-01-08T09:30:00-05:00'),
    });
  });

  it('no sugiere horarios fuera del horario laboral (8-18 locales por defecto)', () => {
    const sugerencias = sugerirHorarios({
      inicioSolicitado: new Date('2024-01-08T17:50:00-05:00'),
      duracionMinutos: 60,
      turnosOcupados: [],
      diasBusqueda: 1,
    });

    expect(sugerencias.length).toBeGreaterThan(0);
    for (const { inicio, fin } of sugerencias) {
      const i = partesEnZona(inicio, BOGOTA);
      const f = partesEnZona(fin, BOGOTA);
      expect(i.hora).toBeGreaterThanOrEqual(8);
      expect(f.hora < 18 || (f.hora === 18 && f.minuto === 0)).toBe(true);
    }
  });

  it('no sugiere horarios que se solapen con turnos ocupados', () => {
    const ocupado = {
      inicio: new Date('2024-01-08T09:00:00-05:00'),
      fin: new Date('2024-01-08T09:30:00-05:00'),
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
      inicio: new Date('2024-01-08T09:00:00-05:00'),
      fin: new Date('2024-01-08T09:30:00-05:00'),
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
      inicio: new Date('2024-01-08T00:00:00-05:00'),
      fin: new Date('2024-01-11T00:00:00-05:00'),
    };

    const sugerencias = sugerirHorarios({
      inicioSolicitado: LUNES_9AM,
      duracionMinutos: 30,
      turnosOcupados: [ocupadoTodoElDia],
      diasBusqueda: 3,
    });

    expect(sugerencias).toEqual([]);
  });

  describe('cerca de medianoche (Sprint 12)', () => {
    it('una solicitud a las 23:30 locales explora ese dia local, no el dia UTC siguiente', () => {
      // 23:30 del lunes en Bogota = 04:30 UTC del MARTES.
      const sugerencias = sugerirHorarios({
        inicioSolicitado: new Date('2024-01-08T23:30:00-05:00'),
        duracionMinutos: 30,
        turnosOcupados: [],
        diasBusqueda: 1,
      });

      expect(sugerencias.length).toBeGreaterThan(0);
      for (const { inicio } of sugerencias) {
        expect(fechaEnZona(inicio, BOGOTA)).toBe('2024-01-08');
      }
      // Lo mas cercano a las 23:30 es el ultimo hueco antes del cierre.
      expect(sugerencias[0].inicio).toEqual(
        new Date('2024-01-08T17:30:00-05:00'),
      );
    });

    it('una solicitud a las 00:15 locales explora ese mismo dia local', () => {
      // 00:15 del martes en Bogota = 05:15 UTC del martes; con el corte UTC
      // coincidia por casualidad, pero a las 00:15 de Tokio no.
      const sugerencias = sugerirHorarios({
        inicioSolicitado: new Date('2024-01-09T00:15:00-05:00'),
        duracionMinutos: 30,
        turnosOcupados: [],
        diasBusqueda: 1,
      });

      expect(sugerencias[0].inicio).toEqual(
        new Date('2024-01-09T08:00:00-05:00'),
      );
    });

    it('usa la zona que se le pasa, independiente de la del proceso', () => {
      // 00:15 del martes en Tokio (UTC+9) = 15:15 UTC del LUNES.
      const sugerencias = sugerirHorarios({
        inicioSolicitado: new Date('2024-01-09T00:15:00+09:00'),
        duracionMinutos: 30,
        turnosOcupados: [],
        diasBusqueda: 1,
        zonaHoraria: 'Asia/Tokyo',
      });

      expect(sugerencias[0].inicio).toEqual(
        new Date('2024-01-09T08:00:00+09:00'),
      );
    });
  });
});
