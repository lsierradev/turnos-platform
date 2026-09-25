import { ContextoDb, DATA_SOURCE_TENANT } from '@turnos-platform/tenant';
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { RedisCacheService } from '../../common/redis-cache.service';
import { DashboardService } from './dashboard.service';

interface FilaCruda {
  // YYYY-MM-DD ya en la zona de negocio: la consulta lo devuelve con to_char.
  dia: string;
  atendidos: number;
  no_asistio: number;
  cancelados: number;
  programados: number;
  medidos: number;
  segundos_servicio: string;
}

function fila(dia: string, valores: Partial<FilaCruda> = {}): FilaCruda {
  return {
    dia,
    atendidos: 0,
    no_asistio: 0,
    cancelados: 0,
    programados: 0,
    medidos: 0,
    segundos_servicio: '0',
    ...valores,
  };
}

describe('DashboardService', () => {
  let service: DashboardService;
  let dataSource: jest.Mocked<DataSource>;
  // La query que corre DENTRO de la transaccion, ya sin el SET LOCAL.
  let queryKpis: jest.Mock;
  let cache: { obtener: jest.Mock; guardar: jest.Mock };

  beforeEach(async () => {
    queryKpis = jest.fn().mockResolvedValue([]);
    // Cache vacio por defecto: cada test ejercita la consulta real. El
    // comportamiento del cache tiene sus propios tests mas abajo.
    cache = { obtener: jest.fn().mockResolvedValue(null), guardar: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        // Fuera de un request: modo sistema, usa los mocks de abajo.
        ContextoDb,
        { provide: DATA_SOURCE_TENANT, useExisting: DataSource },
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn(
              (cb: (manager: { query: jest.Mock }) => unknown) =>
                cb({ query: queryKpis }),
            ),
          },
        },
        { provide: RedisCacheService, useValue: cache },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
    dataSource = module.get(DataSource);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('rango de fechas', () => {
    it('traduce from/to inclusive a una ventana half-open en dias de Bogota', async () => {
      await service.kpis({ from: '2024-01-08', to: '2024-01-09' });

      // El primer query() de la transaccion es el SET LOCAL statement_timeout.
      const [sql, params] = queryKpis.mock.calls[1];
      // 00:00 en Bogota (UTC-5) = 05:00Z. La ventana arranca en el periodo
      // ANTERIOR (06 y 07 de enero, mismos 2 dias) para comparar.
      expect(params[0]).toEqual(new Date('2024-01-06T05:00:00.000Z'));
      expect(params[1]).toEqual(new Date('2024-01-10T05:00:00.000Z'));
      // Y el agrupado por dia usa la misma zona, no la de la sesion.
      expect(params[2]).toBe('America/Bogota');
      expect(sql).toContain('AT TIME ZONE $3');
    });

    it('acota la consulta con un statement_timeout propio', async () => {
      await service.kpis({ from: '2024-01-08', to: '2024-01-08' });

      expect(queryKpis.mock.calls[0][0]).toContain(
        'SET LOCAL statement_timeout',
      );
    });

    it('rechaza un from posterior al to', async () => {
      await expect(
        service.kpis({ from: '2024-02-01', to: '2024-01-01' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza un rango mas largo que el tope permitido', async () => {
      await expect(
        service.kpis({ from: '2024-01-01', to: '2024-12-31' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza una fecha con forma valida pero inexistente', async () => {
      await expect(service.kpis({ from: '2024-13-45' })).rejects.toThrow(
        BadRequestException,
      );
    });

    describe('sin from ni to usa el dia de hoy del taller (Sprint 12)', () => {
      afterEach(() => {
        jest.useRealTimers();
      });

      function congelarReloj(instante: string) {
        // Solo el reloj: las promesas tienen que seguir resolviendo solas.
        jest.useFakeTimers({
          now: new Date(instante),
          doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
        });
      }

      it('a las 23:30 locales hoy sigue siendo hoy, aunque en UTC ya sea manana', async () => {
        congelarReloj('2024-01-08T23:30:00-05:00'); // 04:30Z del 9

        const resultado = await service.kpis({});

        expect(resultado.rango).toEqual({
          from: '2024-01-08',
          to: '2024-01-08',
        });
        expect(resultado.serie).toHaveLength(1);
      });

      it('a las 00:10 locales ya es el dia nuevo', async () => {
        congelarReloj('2024-01-09T00:10:00-05:00');

        const resultado = await service.kpis({});

        expect(resultado.rango).toEqual({
          from: '2024-01-09',
          to: '2024-01-09',
        });
      });

      it('a las 19:00 locales (00:00Z) no salta al dia siguiente', async () => {
        congelarReloj('2024-01-08T19:00:00-05:00');

        const resultado = await service.kpis({});

        expect(resultado.rango.from).toBe('2024-01-08');
      });
    });
  });

  describe('tasa de asistencia', () => {
    it('divide atendidos sobre el total de turnos cerrados', async () => {
      queryKpis.mockResolvedValue([
        fila('2024-01-08', { atendidos: 8, no_asistio: 2 }),
      ]);

      const { resumen } = await service.kpis({
        from: '2024-01-08',
        to: '2024-01-08',
      });

      expect(resumen.tasaAsistencia).toBe(0.8);
    });

    it('excluye cancelados y programados del denominador', async () => {
      queryKpis.mockResolvedValue([
        fila('2024-01-08', {
          atendidos: 3,
          no_asistio: 1,
          cancelados: 10,
          programados: 20,
        }),
      ]);

      const { resumen } = await service.kpis({
        from: '2024-01-08',
        to: '2024-01-08',
      });

      // 3 / (3 + 1), no 3 / 34: cancelar avisando no es una inasistencia y
      // un turno todavia programado no se cerro.
      expect(resumen.tasaAsistencia).toBe(0.75);
      expect(resumen.turnosCancelados).toBe(10);
      expect(resumen.turnosProgramados).toBe(20);
      expect(resumen.turnosTotales).toBe(34);
    });

    it('devuelve null (no 0) cuando no hay turnos cerrados', async () => {
      queryKpis.mockResolvedValue([fila('2024-01-08', { programados: 5 })]);

      const { resumen } = await service.kpis({
        from: '2024-01-08',
        to: '2024-01-08',
      });

      // 0% y "sin datos" son cosas distintas: un 0% dibujado en el grafico
      // le diria al admin que no fue nadie, cuando en realidad el dia aun
      // no cerro ningun turno.
      expect(resumen.tasaAsistencia).toBeNull();
    });
  });

  describe('tiempo promedio de servicio', () => {
    it('promedia sobre los turnos medidos, en minutos', async () => {
      queryKpis.mockResolvedValue([
        fila('2024-01-08', {
          atendidos: 2,
          medidos: 2,
          segundos_servicio: String(30 * 60 + 50 * 60),
        }),
      ]);

      const { resumen } = await service.kpis({
        from: '2024-01-08',
        to: '2024-01-08',
      });

      expect(resumen.minutosPromedioServicio).toBe(40);
    });

    it('ignora los atendidos sin medicion y reporta la cobertura', async () => {
      queryKpis.mockResolvedValue([
        fila('2024-01-08', {
          atendidos: 10,
          medidos: 1,
          segundos_servicio: String(45 * 60),
        }),
      ]);

      const { resumen } = await service.kpis({
        from: '2024-01-08',
        to: '2024-01-08',
      });

      expect(resumen.minutosPromedioServicio).toBe(45);
      expect(resumen.turnosMedidos).toBe(1);
      expect(resumen.turnosAtendidos).toBe(10);
    });

    it('pondera por cantidad de turnos, no promedia los promedios diarios', async () => {
      queryKpis.mockResolvedValue([
        // Dia flojo: 1 turno de 100 min.
        fila('2024-01-08', {
          atendidos: 1,
          medidos: 1,
          segundos_servicio: String(100 * 60),
        }),
        // Dia cargado: 9 turnos de 20 min.
        fila('2024-01-09', {
          atendidos: 9,
          medidos: 9,
          segundos_servicio: String(9 * 20 * 60),
        }),
      ]);

      const { resumen } = await service.kpis({
        from: '2024-01-08',
        to: '2024-01-09',
      });

      // (100 + 180) / 10 = 28. Promediar los promedios daria (100+20)/2 = 60,
      // mas del doble: es el bug que evita devolver sumas desde SQL.
      expect(resumen.minutosPromedioServicio).toBe(28);
    });
  });

  describe('serie diaria', () => {
    it('rellena con ceros los dias sin turnos', async () => {
      queryKpis.mockResolvedValue([
        fila('2024-01-08', { atendidos: 4 }),
        fila('2024-01-10', { atendidos: 6 }),
      ]);

      const { serie } = await service.kpis({
        from: '2024-01-08',
        to: '2024-01-10',
      });

      expect(serie.map((d) => d.fecha)).toEqual([
        '2024-01-08',
        '2024-01-09',
        '2024-01-10',
      ]);
      expect(serie[1].atendidos).toBe(0);
      expect(serie[1].tasaAsistencia).toBeNull();
    });

    it('calcula el KPI de cada dia por separado', async () => {
      queryKpis.mockResolvedValue([
        fila('2024-01-08', { atendidos: 1, no_asistio: 1 }),
        fila('2024-01-09', { atendidos: 3, no_asistio: 1 }),
      ]);

      const { serie } = await service.kpis({
        from: '2024-01-08',
        to: '2024-01-09',
      });

      expect(serie[0].tasaAsistencia).toBe(0.5);
      expect(serie[1].tasaAsistencia).toBe(0.75);
    });
  });

  describe('cache de lecturas', () => {
    it('devuelve lo cacheado sin tocar la base', async () => {
      const guardado = {
        rango: { from: '2024-01-08', to: '2024-01-08' },
        resumen: { tasaAsistencia: 0.9 },
        serie: [],
      };
      cache.obtener.mockResolvedValue(guardado);

      const resultado = await service.kpis({
        from: '2024-01-08',
        to: '2024-01-08',
      });

      expect(resultado).toBe(guardado);
      expect(queryKpis).not.toHaveBeenCalled();
    });

    it('cachea por rango, no en una sola entrada global', async () => {
      await service.kpis({ from: '2024-01-08', to: '2024-01-09' });

      expect(cache.obtener).toHaveBeenCalledWith(
        'kpis:sistema:America/Bogota:2024-01-08:2024-01-09:todos',
      );
      expect(cache.guardar).toHaveBeenCalledWith(
        'kpis:sistema:America/Bogota:2024-01-08:2024-01-09:todos',
        expect.objectContaining({
          rango: { from: '2024-01-08', to: '2024-01-09' },
        }),
        expect.any(Number),
      );
    });
  });

  it('resuelve todo con una sola consulta agregada', async () => {
    queryKpis.mockResolvedValue([fila('2024-01-08', { atendidos: 1 })]);

    await service.kpis({ from: '2024-01-08', to: '2024-03-01' });

    // SET LOCAL + la agregacion. Que esto sea 2 y no dependa del largo del
    // rango es la garantia de la tarea 3: el dashboard no le hace N
    // consultas a la tabla caliente de reservas.
    expect(queryKpis).toHaveBeenCalledTimes(2);
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });

  describe('periodo anterior (Sprint 18)', () => {
    it('resume el periodo de igual largo que termina el dia antes', async () => {
      queryKpis.mockResolvedValue([
        fila('2024-01-01', { atendidos: 1, no_asistio: 1 }),
        fila('2024-01-07', { atendidos: 2, no_asistio: 2 }),
        fila('2024-01-08', { atendidos: 9, no_asistio: 1 }),
      ]);

      const r = await service.kpis({ from: '2024-01-08', to: '2024-01-14' });

      expect(r.anterior.rango).toEqual({
        from: '2024-01-01',
        to: '2024-01-07',
      });
      expect(r.anterior.resumen.turnosAtendidos).toBe(3);
      expect(r.anterior.resumen.tasaAsistencia).toBe(0.5);
      // Lo del periodo anterior no se cuela en el actual.
      expect(r.resumen.turnosAtendidos).toBe(9);
      expect(r.serie.map((d) => d.fecha)[0]).toBe('2024-01-08');
      expect(r.serie).toHaveLength(7);
    });

    it('para un solo dia compara contra el dia anterior', async () => {
      const r = await service.kpis({ from: '2024-01-08', to: '2024-01-08' });

      expect(r.anterior.rango).toEqual({
        from: '2024-01-07',
        to: '2024-01-07',
      });
    });
  });

  describe('por tecnico (Sprint 18)', () => {
    it('filtra la consulta por tecnico y lo separa en la cache', async () => {
      const r = await service.kpis({
        from: '2024-01-08',
        to: '2024-01-08',
        tecnicoId: 't-1',
      });

      const [sql, params] = queryKpis.mock.calls[1];
      expect(sql).toContain('tecnico_id = $4');
      expect(params[3]).toBe('t-1');
      expect(r.tecnicoId).toBe('t-1');
      expect(cache.obtener).toHaveBeenCalledWith(
        'kpis:sistema:America/Bogota:2024-01-08:2024-01-08:t-1',
      );
    });

    it('sin tecnico manda null (el taller entero)', async () => {
      await service.kpis({ from: '2024-01-08', to: '2024-01-08' });

      expect(queryKpis.mock.calls[1][1][3]).toBeNull();
    });
  });
});
