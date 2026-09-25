import { ContextoDb, DATA_SOURCE_TENANT } from '@turnos-platform/tenant';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Turno } from '../../entities/turno.entity';
import { TechniciansService } from './technicians.service';

describe('TechniciansService', () => {
  let service: TechniciansService;
  let turnosRepository: jest.Mocked<Repository<Turno>>;
  let dataSource: jest.Mocked<DataSource>;

  const tecnicoId = 't-1';
  // Dia de negocio (TZ_NEGOCIO, default America/Bogota = UTC-5 sin DST).
  const fecha = '2024-01-08';

  function turno(horaISO: string, id: string): Turno {
    return {
      id,
      tecnicoId,
      rangoTiempo: {
        inicio: new Date(horaISO),
        fin: new Date(new Date(horaISO).getTime() + 30 * 60_000),
      },
    } as Turno;
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TechniciansService,
        // Fuera de un request: modo sistema, usa los mocks de abajo.
        ContextoDb,
        { provide: DATA_SOURCE_TENANT, useExisting: DataSource },
        {
          provide: getRepositoryToken(Turno),
          useValue: { find: jest.fn() },
        },
        {
          provide: DataSource,
          useValue: { query: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<TechniciansService>(TechniciansService);
    turnosRepository = module.get(getRepositoryToken(Turno));
    dataSource = module.get(DataSource);

    dataSource.query.mockResolvedValue([{ id: tecnicoId, rol: 'tecnico' }]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('lanza NotFoundException si el tecnico no existe', async () => {
    dataSource.query.mockResolvedValue([]);

    await expect(service.agendaDelDia(tecnicoId, fecha)).rejects.toThrow(
      NotFoundException,
    );
    expect(turnosRepository.find).not.toHaveBeenCalled();
  });

  it('lanza NotFoundException si el usuario no tiene rol de tecnico', async () => {
    dataSource.query.mockResolvedValue([{ id: tecnicoId, rol: 'cliente' }]);

    await expect(service.agendaDelDia(tecnicoId, fecha)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('devuelve arreglo vacio si no hay turnos', async () => {
    turnosRepository.find.mockResolvedValue([]);

    await expect(service.agendaDelDia(tecnicoId, fecha)).resolves.toEqual([]);
  });

  it('ordena por hora los turnos que devuelve la consulta', async () => {
    const tarde = turno('2024-01-08T15:00:00.000Z', 't-tarde');
    const temprano = turno('2024-01-08T08:00:00.000Z', 't-temprano');
    turnosRepository.find.mockResolvedValue([tarde, temprano]);

    const agenda = await service.agendaDelDia(tecnicoId, fecha);

    expect(agenda.map((t) => t.id)).toEqual(['t-temprano', 't-tarde']);
  });

  it('delega el filtro por fecha a SQL y no trae el historico completo', async () => {
    turnosRepository.find.mockResolvedValue([]);

    await service.agendaDelDia(tecnicoId, fecha);

    // Esta es la regresion que importa: antes el where era solo
    // { tecnicoId } y el dia se filtraba en memoria, lo que traia todos los
    // turnos historicos del tecnico en cada carga de la agenda. Si alguien
    // vuelve a sacar la condicion de rango, este test falla.
    const argumentos = turnosRepository.find.mock.calls[0]?.[0];
    expect(argumentos?.where).toEqual(
      expect.objectContaining({
        tecnicoId,
        rangoTiempo: expect.anything(),
      }),
    );

    // Raw() de TypeORM expone la condicion como funcion del alias de columna.
    const condicion = (
      argumentos?.where as { rangoTiempo: { getSql: (a: string) => string } }
    ).rangoTiempo;
    expect(condicion.getSql('rango_tiempo')).toContain('tstzrange');
  });

  describe('corte de dia en la zona del taller (Sprint 12)', () => {
    const zonaOriginal = process.env.TZ_NEGOCIO;

    afterEach(() => {
      if (zonaOriginal === undefined) {
        delete process.env.TZ_NEGOCIO;
      } else {
        process.env.TZ_NEGOCIO = zonaOriginal;
      }
    });

    function ventanaConsultada(): { desde: Date; hasta: Date } {
      const where = turnosRepository.find.mock.calls[0]?.[0]?.where as {
        rangoTiempo: { objectLiteralParameters: { desde: Date; hasta: Date } };
      };
      return where.rangoTiempo.objectLiteralParameters;
    }

    it('el dia va de 00:00 a 24:00 de Bogota, no de UTC', async () => {
      delete process.env.TZ_NEGOCIO;
      turnosRepository.find.mockResolvedValue([]);

      await service.agendaDelDia(tecnicoId, '2024-01-08');

      // 00:00 en Bogota = 05:00 UTC. Un turno a las 20:00 locales del 8
      // (01:00 UTC del 9) cae adentro; con el corte UTC caia en el 9.
      expect(ventanaConsultada()).toEqual({
        desde: new Date('2024-01-08T05:00:00.000Z'),
        hasta: new Date('2024-01-09T05:00:00.000Z'),
      });
    });

    it('respeta TZ_NEGOCIO configurada', async () => {
      process.env.TZ_NEGOCIO = 'Asia/Tokyo'; // UTC+9
      turnosRepository.find.mockResolvedValue([]);

      await service.agendaDelDia(tecnicoId, '2024-01-08');

      expect(ventanaConsultada()).toEqual({
        desde: new Date('2024-01-07T15:00:00.000Z'),
        hasta: new Date('2024-01-08T15:00:00.000Z'),
      });
    });
  });
});
