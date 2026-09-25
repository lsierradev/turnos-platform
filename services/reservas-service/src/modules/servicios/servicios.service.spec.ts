import { ContextoDb, DATA_SOURCE_TENANT } from '@turnos-platform/tenant';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CategoriaServicio, Servicio } from './entities/servicio.entity';
import { ServiciosService } from './servicios.service';

describe('ServiciosService', () => {
  let service: ServiciosService;
  let repository: jest.Mocked<Repository<Servicio>>;

  const servicio: Servicio = {
    id: 's-1',
    tallerId: 'taller-1',
    nombre: 'Cambio de aceite',
    categoria: CategoriaServicio.MECANICA,
    duracionMinutos: 30,
    precio: 25000,
    activo: true,
    creadoEn: new Date(),
    actualizadoEn: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiciosService,
        // Fuera de un request: modo sistema, usa los mocks de abajo.
        ContextoDb,
        { provide: DATA_SOURCE_TENANT, useValue: {} },
        {
          provide: getRepositoryToken(Servicio),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            remove: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ServiciosService>(ServiciosService);
    repository = module.get(getRepositoryToken(Servicio));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('crea un servicio', async () => {
    const dto = {
      nombre: servicio.nombre,
      categoria: servicio.categoria,
      duracionMinutos: servicio.duracionMinutos,
      precio: servicio.precio,
    };
    repository.create.mockReturnValue(servicio);
    repository.save.mockResolvedValue(servicio);

    await expect(service.create(dto)).resolves.toEqual(servicio);
    expect(repository.create).toHaveBeenCalledWith(dto);
    expect(repository.save).toHaveBeenCalledWith(servicio);
  });

  it('lista todos los servicios', async () => {
    repository.find.mockResolvedValue([servicio]);

    await expect(service.findAll()).resolves.toEqual([servicio]);
  });

  it('encuentra un servicio por id', async () => {
    repository.findOne.mockResolvedValue(servicio);

    await expect(service.findOne('s-1')).resolves.toEqual(servicio);
    expect(repository.findOne).toHaveBeenCalledWith({ where: { id: 's-1' } });
  });

  it('lanza NotFoundException si el servicio no existe', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(service.findOne('no-existe')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('actualiza un servicio existente', async () => {
    repository.findOne.mockResolvedValue(servicio);
    const actualizado = { ...servicio, precio: 30000 };
    repository.save.mockResolvedValue(actualizado);

    await expect(service.update('s-1', { precio: 30000 })).resolves.toEqual(
      actualizado,
    );
  });

  it('propaga NotFoundException al actualizar un servicio inexistente', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(
      service.update('no-existe', { precio: 30000 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('elimina un servicio existente', async () => {
    repository.findOne.mockResolvedValue(servicio);
    repository.remove.mockResolvedValue(servicio);

    await service.remove('s-1');
    expect(repository.remove).toHaveBeenCalledWith(servicio);
  });

  it('propaga NotFoundException al eliminar un servicio inexistente', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(service.remove('no-existe')).rejects.toThrow(
      NotFoundException,
    );
  });
});
