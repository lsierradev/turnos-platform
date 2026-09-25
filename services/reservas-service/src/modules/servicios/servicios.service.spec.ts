import { ContextoDb, DATA_SOURCE_TENANT } from '@turnos-platform/tenant';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
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
    precioBaseCentavos: 2_500_000,
    tarifaIva: 19,
    requiereAnticipo: false,
    porcentajeAnticipo: null,
    garantiaDias: 30,
    activo: true,
    creadoEn: new Date(),
    actualizadoEn: new Date(),
  };

  // Fuera de un request (sin taller) el precio sale "No responsable": el
  // cargado es el final, como hasta Sprint 20.
  const sinIva = {
    baseCentavos: 2_500_000,
    ivaCentavos: 0,
    totalCentavos: 2_500_000,
    tarifaIva: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiciosService,
        // Fuera de un request: modo sistema, usa los mocks de abajo.
        ContextoDb,
        { provide: DATA_SOURCE_TENANT, useValue: {} },
        { provide: DataSource, useValue: {} },
        {
          provide: getRepositoryToken(Servicio),
          useValue: {
            create: jest.fn((dto) => ({ ...dto })),
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

  it('crea un servicio y lo devuelve con su precio calculado', async () => {
    const dto = {
      nombre: servicio.nombre,
      categoria: servicio.categoria,
      duracionMinutos: servicio.duracionMinutos,
      precioBaseCentavos: servicio.precioBaseCentavos,
    };
    repository.save.mockResolvedValue(servicio);

    await expect(service.create(dto)).resolves.toEqual({
      ...servicio,
      precio: sinIva,
      anticipo: null,
    });
    expect(repository.create).toHaveBeenCalledWith(dto);
  });

  it('sin anticipo descarta un porcentaje suelto (la constraint lo rechazaria)', async () => {
    repository.save.mockImplementation(async (s) => s as Servicio);
    await service.create({
      ...servicio,
      requiereAnticipo: false,
      porcentajeAnticipo: 18,
    });
    expect(repository.save.mock.calls[0][0]).toMatchObject({
      requiereAnticipo: false,
      porcentajeAnticipo: null,
    });
  });

  it('con anticipo exige el porcentaje', async () => {
    await expect(
      service.create({
        ...servicio,
        requiereAnticipo: true,
        porcentajeAnticipo: null,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  describe('presentar', () => {
    it('responsable de IVA: base + 19% = total, con la tarifa', () => {
      expect(service.presentar(servicio, true).precio).toEqual({
        baseCentavos: 2_500_000,
        ivaCentavos: 475_000,
        totalCentavos: 2_975_000,
        tarifaIva: 19,
      });
    });

    it('no responsable: sin IVA y sin tarifa (no se muestra la leyenda)', () => {
      expect(service.presentar(servicio, false).precio).toEqual(sinIva);
    });

    it('anticipo sobre el total con IVA', () => {
      const conAnticipo = {
        ...servicio,
        requiereAnticipo: true,
        porcentajeAnticipo: 20,
      };
      expect(service.presentar(conAnticipo, true).anticipo).toEqual({
        porcentaje: 20,
        centavos: 595_000,
      });
    });
  });

  it('lista los servicios con precio', async () => {
    repository.find.mockResolvedValue([servicio]);

    await expect(service.findAll()).resolves.toEqual([
      { ...servicio, precio: sinIva, anticipo: null },
    ]);
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
    repository.findOne.mockResolvedValue({ ...servicio });
    repository.save.mockImplementation(async (s) => s as Servicio);

    const r = await service.update('s-1', { precioBaseCentavos: 3_000_000 });
    expect(r.precio.totalCentavos).toBe(3_000_000);
  });

  it('propaga NotFoundException al actualizar un servicio inexistente', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(
      service.update('no-existe', { precioBaseCentavos: 3_000_000 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('elimina un servicio sin turnos', async () => {
    repository.findOne.mockResolvedValue(servicio);
    repository.remove.mockResolvedValue(servicio);

    await service.remove('s-1');
    expect(repository.remove).toHaveBeenCalledWith(servicio);
  });

  it('un servicio con turnos no se borra: 409 que sugiere desactivarlo', async () => {
    repository.findOne.mockResolvedValue(servicio);
    const fk = new QueryFailedError('DELETE', [], new Error('fk'));
    (fk as unknown as { driverError: { code: string } }).driverError = {
      code: '23503',
    };
    repository.remove.mockRejectedValue(fk);

    await expect(service.remove('s-1')).rejects.toThrow(ConflictException);
  });

  it('propaga NotFoundException al eliminar un servicio inexistente', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(service.remove('no-existe')).rejects.toThrow(
      NotFoundException,
    );
  });
});
