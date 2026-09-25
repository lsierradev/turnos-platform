import { ContextoDb, DATA_SOURCE_TENANT } from '@turnos-platform/tenant';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { RedisCacheService } from '../../common/redis-cache.service';
import { HorarioService } from '../configuracion/horario.service';
import { BahiasService } from './bahias.service';

interface FilaCruda {
  bahiaId: string;
  nombre: string;
  fecha: string;
  turnos: number;
  minutosOcupados: number;
}

const fila = (
  bahiaId: string,
  fecha: string,
  turnos: number,
  minutosOcupados: number,
): FilaCruda => ({
  bahiaId,
  nombre: `Bahia ${bahiaId}`,
  fecha,
  turnos,
  minutosOcupados,
});

describe('BahiasService', () => {
  let service: BahiasService;
  // La query que corre DENTRO de la transaccion (la primera es el SET LOCAL).
  let queryTx: jest.Mock;
  let queryDirecta: jest.Mock;
  let cache: { obtener: jest.Mock; guardar: jest.Mock };
  const zonaOriginal = process.env.TZ_NEGOCIO;

  beforeEach(async () => {
    delete process.env.TZ_NEGOCIO;
    queryTx = jest.fn().mockResolvedValue([]);
    queryDirecta = jest.fn();
    cache = { obtener: jest.fn().mockResolvedValue(null), guardar: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BahiasService,
        // Sin taller: el horario historico (todos los dias 08:00-18:00).
        HorarioService,
        // Fuera de un request: modo sistema, usa los mocks de abajo.
        ContextoDb,
        { provide: DATA_SOURCE_TENANT, useExisting: DataSource },
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn((cb: (m: { query: jest.Mock }) => unknown) =>
              cb({ query: queryTx }),
            ),
            query: queryDirecta,
          },
        },
        { provide: RedisCacheService, useValue: cache },
      ],
    }).compile();

    service = module.get(BahiasService);
  });

  afterEach(() => {
    jest.useRealTimers();
    if (zonaOriginal === undefined) delete process.env.TZ_NEGOCIO;
    else process.env.TZ_NEGOCIO = zonaOriginal;
  });

  describe('carga: rango y parametros', () => {
    it('traduce el rango a dias del taller y a la ventana half-open en Bogota', async () => {
      await service.carga({ desde: '2024-01-08', hasta: '2024-01-09' });

      const [sql, params] = queryTx.mock.calls[1];
      // La jornada de cada dia del rango (Sprint 21), como JSON.
      expect(JSON.parse(params[0])).toEqual([
        { dia: '2024-01-08', apertura: '08:00', cierre: '18:00' },
        { dia: '2024-01-09', apertura: '08:00', cierre: '18:00' },
      ]);
      expect(params[1]).toBe('America/Bogota');
      // 00:00 en Bogota = 05:00Z; hasta es el inicio del dia SIGUIENTE a `hasta`.
      expect(params[2]).toEqual(new Date('2024-01-08T05:00:00.000Z'));
      expect(params[3]).toEqual(new Date('2024-01-10T05:00:00.000Z'));
      // Sargable contra idx_turnos_kpi_inicio y sin contar cancelados.
      expect(sql).toContain('lower(t.rango_tiempo) >= $3');
      expect(sql).toContain("t.estado <> 'cancelado'");
    });

    it('acota la consulta con statement_timeout', async () => {
      await service.carga({ desde: '2024-01-08' });
      expect(queryTx.mock.calls[0][0]).toContain('SET LOCAL statement_timeout');
    });

    it('con una sola fecha usa ese dia como rango', async () => {
      const r = await service.carga({ desde: '2024-01-08' });
      expect([r.desde, r.hasta]).toEqual(['2024-01-08', '2024-01-08']);
    });

    it('sin fechas usa hoy del taller, no hoy UTC (23:30 locales)', async () => {
      jest.useFakeTimers({
        now: new Date('2024-01-08T23:30:00-05:00'), // 04:30Z del 9
        doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
      });
      const r = await service.carga({});
      expect(r.desde).toBe('2024-01-08');
    });

    it('rechaza desde posterior a hasta', async () => {
      await expect(
        service.carga({ desde: '2024-01-10', hasta: '2024-01-08' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza rangos de mas de 31 dias', async () => {
      await expect(
        service.carga({ desde: '2024-01-01', hasta: '2024-02-01' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza una fecha con forma valida pero inexistente', async () => {
      await expect(service.carga({ desde: '2024-02-30' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('carga: calculo', () => {
    it('agrupa por bahia, calcula ocupacion sobre la jornada y el nivel', async () => {
      queryTx
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([
          fila('a', '2024-01-08', 0, 0),
          fila('b', '2024-01-08', 3, 300),
          fila('c', '2024-01-08', 8, 480),
          fila('d', '2024-01-08', 10, 600),
        ]);

      const r = await service.carga({ desde: '2024-01-08' });

      expect(
        r.bahias.map((b) => [b.bahiaId, b.dias[0].ocupacion, b.dias[0].nivel]),
      ).toEqual([
        ['a', 0, 'libre'],
        ['b', 0.5, 'normal'],
        ['c', 0.8, 'alta'],
        ['d', 1, 'completa'],
      ]);
      expect(r.jornada).toEqual({
        apertura: '08:00',
        cierre: '18:00',
        minutos: 600,
      });
      expect(r.umbrales).toEqual({ alta: 0.8, completa: 1 });
    });

    it('resume cada dia sobre la capacidad de todas las bahias', async () => {
      queryTx
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([
          fila('a', '2024-01-08', 2, 120),
          fila('a', '2024-01-09', 0, 0),
          fila('b', '2024-01-08', 9, 540),
          fila('b', '2024-01-09', 1, 60),
        ]);

      const r = await service.carga({
        desde: '2024-01-08',
        hasta: '2024-01-09',
      });

      expect(r.resumen).toEqual([
        // (120 + 540) / (600 * 2) = 0.55; b al 90% esta en alerta.
        {
          fecha: '2024-01-08',
          jornada: { apertura: '08:00', cierre: '18:00', minutos: 600 },
          cerrado: null,
          turnos: 11,
          minutosOcupados: 660,
          ocupacion: 0.55,
          bahiasEnAlerta: 1,
        },
        {
          fecha: '2024-01-09',
          jornada: { apertura: '08:00', cierre: '18:00', minutos: 600 },
          cerrado: null,
          turnos: 1,
          minutosOcupados: 60,
          ocupacion: 0.05,
          bahiasEnAlerta: 0,
        },
      ]);
    });

    it('el driver devuelve sum() como string: se convierte a numero', async () => {
      queryTx
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([
          { ...fila('a', '2024-01-08', 1, 0), minutosOcupados: '45.0000' },
        ]);

      const r = await service.carga({ desde: '2024-01-08' });
      expect(r.bahias[0].dias[0].minutosOcupados).toBe(45);
    });
  });

  describe('carga: cache', () => {
    it('devuelve lo cacheado sin tocar la base', async () => {
      const guardado = { desde: '2024-01-08' };
      cache.obtener.mockResolvedValue(guardado);

      await expect(service.carga({ desde: '2024-01-08' })).resolves.toBe(
        guardado,
      );
      expect(queryTx).not.toHaveBeenCalled();
    });

    it('cachea por zona y rango con TTL corto', async () => {
      await service.carga({ desde: '2024-01-08', hasta: '2024-01-14' });

      const clave = 'carga-bahias:sistema:America/Bogota:2024-01-08:2024-01-14';
      expect(cache.obtener).toHaveBeenCalledWith(clave);
      expect(cache.guardar).toHaveBeenCalledWith(clave, expect.any(Object), 5);
    });
  });

  describe('turnosDeBahia', () => {
    const bahiaId = '11111111-1111-4111-8111-111111111111';

    it('404 si la bahia no existe', async () => {
      queryDirecta.mockResolvedValueOnce([]);
      await expect(
        service.turnosDeBahia(bahiaId, '2024-01-08'),
      ).rejects.toThrow(NotFoundException);
    });

    it('trae los turnos del dia del taller con servicio, tecnico y cliente', async () => {
      queryDirecta
        .mockResolvedValueOnce([
          { id: bahiaId, nombre: 'Bahia 1', activa: true },
        ])
        .mockResolvedValueOnce([
          {
            id: 't1',
            inicio: new Date('2024-01-08T14:00:00.000Z'),
            fin: new Date('2024-01-08T14:30:00.000Z'),
            estado: 'programado',
            servicioNombre: 'Cambio de aceite',
            servicioCategoria: 'mecanica',
            tecnicoId: 'tec-1',
            tecnicoNombre: 'Ana',
            clienteNombre: 'Luis',
          },
        ]);

      const r = await service.turnosDeBahia(bahiaId, '2024-01-08');

      const [, params] = queryDirecta.mock.calls[1];
      expect(params).toEqual([
        bahiaId,
        new Date('2024-01-08T05:00:00.000Z'),
        new Date('2024-01-09T05:00:00.000Z'),
      ]);
      expect(r.turnos[0]).toEqual({
        id: 't1',
        inicio: '2024-01-08T14:00:00.000Z',
        fin: '2024-01-08T14:30:00.000Z',
        estado: 'programado',
        servicio: { nombre: 'Cambio de aceite', categoria: 'mecanica' },
        tecnico: { id: 'tec-1', nombre: 'Ana' },
        clienteNombre: 'Luis',
      });
    });

    it('rechaza una fecha inexistente', async () => {
      await expect(
        service.turnosDeBahia(bahiaId, '2024-13-01'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
