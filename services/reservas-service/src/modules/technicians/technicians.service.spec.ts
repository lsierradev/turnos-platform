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
  const fecha = new Date('2024-01-08T00:00:00.000Z');

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

  it('filtra al dia solicitado y ordena por hora', async () => {
    const deOtroDia = turno('2024-01-09T09:00:00.000Z', 't-otro-dia');
    const tarde = turno('2024-01-08T15:00:00.000Z', 't-tarde');
    const temprano = turno('2024-01-08T08:00:00.000Z', 't-temprano');
    turnosRepository.find.mockResolvedValue([deOtroDia, tarde, temprano]);

    const agenda = await service.agendaDelDia(tecnicoId, fecha);

    expect(agenda.map((t) => t.id)).toEqual(['t-temprano', 't-tarde']);
    expect(turnosRepository.find).toHaveBeenCalledWith({
      where: { tecnicoId },
      relations: ['bahia', 'servicio'],
    });
  });
});
