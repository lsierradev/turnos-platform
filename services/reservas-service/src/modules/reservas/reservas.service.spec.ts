import { getQueueToken } from '@nestjs/bull';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { NOMBRE_COLA_NOTIFICACIONES } from '../notifications/notifications.constants';
import { ReservasService } from './reservas.service';

describe('ReservasService', () => {
  let service: ReservasService;
  let dataSource: { query: jest.Mock };
  let cola: { isReady: jest.Mock; client: { ping: jest.Mock } };

  beforeEach(async () => {
    dataSource = { query: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    cola = {
      isReady: jest.fn().mockResolvedValue(undefined),
      client: { ping: jest.fn().mockResolvedValue('PONG') },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservasService,
        { provide: DataSource, useValue: dataSource },
        {
          provide: getQueueToken(NOMBRE_COLA_NOTIFICACIONES),
          useValue: cola,
        },
      ],
    }).compile();

    service = module.get<ReservasService>(ReservasService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('liveness', () => {
    it('reports ok status', () => {
      expect(service.health()).toEqual({ status: 'ok', module: 'reservas' });
    });

    it('no toca las dependencias', () => {
      service.health();

      // Deliberado: si el liveness probara Postgres, una caida momentanea de
      // la base haria que el orquestador reiniciara pods sanos, que es lo
      // contrario de lo que conviene durante un incidente de base de datos.
      expect(dataSource.query).not.toHaveBeenCalled();
      expect(cola.isReady).not.toHaveBeenCalled();
    });
  });

  describe('readiness', () => {
    it('reporta ok cuando Postgres y Redis responden', async () => {
      await expect(service.readiness()).resolves.toEqual({
        status: 'ok',
        module: 'reservas',
        dependencias: {
          postgres: { status: 'up' },
          redis: { status: 'up' },
        },
      });
    });

    it('reporta degradado si Postgres no responde', async () => {
      dataSource.query.mockRejectedValue(new Error('connection refused'));

      const resultado = await service.readiness();

      expect(resultado.status).toBe('degraded');
      expect(resultado.dependencias.postgres).toEqual({
        status: 'down',
        error: 'connection refused',
      });
      // Redis sigue reportandose aparte: durante un incidente hace falta
      // saber cual de las dos se cayo, no solo que algo anda mal.
      expect(resultado.dependencias.redis.status).toBe('up');
    });

    it('reporta degradado si Redis no responde', async () => {
      cola.client.ping.mockRejectedValue(new Error('redis caido'));

      const resultado = await service.readiness();

      expect(resultado.status).toBe('degraded');
      expect(resultado.dependencias.redis.status).toBe('down');
    });

    it('una dependencia colgada no cuelga el probe', async () => {
      // Sin timeout, un Postgres que acepta la conexion pero no responde
      // deja al orquestador esperando indefinidamente por el readiness, que
      // es tan inutil como devolver ok siempre.
      dataSource.query.mockImplementation(() => new Promise(() => undefined));

      const resultado = await service.readiness();

      expect(resultado.status).toBe('degraded');
      expect(resultado.dependencias.postgres.status).toBe('down');
      expect(resultado.dependencias.postgres.error).toMatch(/timeout/i);
    }, 10_000);
  });
});
