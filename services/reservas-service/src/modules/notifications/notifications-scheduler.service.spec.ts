import { getQueueToken } from '@nestjs/bull';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { NotificationsSchedulerService } from './notifications-scheduler.service';
import { NOMBRE_COLA_NOTIFICACIONES } from './notifications.constants';

jest.mock('@turnos-platform/auth', () => ({
  ...jest.requireActual('@turnos-platform/auth'),
  decrypt: jest.fn((valor: string) => `telefono-descifrado(${valor})`),
}));

describe('NotificationsSchedulerService', () => {
  let service: NotificationsSchedulerService;
  let dataSource: jest.Mocked<DataSource>;
  let cola: { add: jest.Mock };

  const turnoBase = {
    turnoId: 't-1',
    inicio: new Date('2024-01-09T09:00:00.000Z'),
    bahiaNombre: 'Bahia 1',
    servicioNombre: 'Cambio de aceite',
    usuarioEmail: 'cliente@turnos.dev',
  };

  beforeEach(async () => {
    cola = { add: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsSchedulerService,
        { provide: DataSource, useValue: { query: jest.fn() } },
        { provide: getQueueToken(NOMBRE_COLA_NOTIFICACIONES), useValue: cola },
      ],
    }).compile();

    service = module.get(NotificationsSchedulerService);
    dataSource = module.get(DataSource);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('encola email y whatsapp cuando el turno tiene ambos y ninguno fue notificado', async () => {
    dataSource.query
      .mockResolvedValueOnce([
        { ...turnoBase, usuarioTelefonoCifrado: 'iv:tag:cifrado' },
      ]) // SELECT
      .mockResolvedValueOnce([{ id: 'notif-email' }]) // INSERT email
      .mockResolvedValueOnce([{ id: 'notif-whatsapp' }]); // INSERT whatsapp

    await service.programarRecordatorios();

    expect(cola.add).toHaveBeenCalledTimes(2);
    expect(cola.add).toHaveBeenCalledWith(
      expect.objectContaining({ notificacionId: 'notif-email' }),
      expect.anything(),
    );
    expect(cola.add).toHaveBeenCalledWith(
      expect.objectContaining({ notificacionId: 'notif-whatsapp' }),
      expect.anything(),
    );
  });

  it('encola solo email cuando el turno no tiene telefono cargado', async () => {
    dataSource.query
      .mockResolvedValueOnce([{ ...turnoBase, usuarioTelefonoCifrado: null }])
      .mockResolvedValueOnce([{ id: 'notif-email' }]);

    await service.programarRecordatorios();

    expect(dataSource.query).toHaveBeenCalledTimes(2); // SELECT + solo 1 INSERT
    expect(cola.add).toHaveBeenCalledTimes(1);
    expect(cola.add).toHaveBeenCalledWith(
      expect.objectContaining({ notificacionId: 'notif-email' }),
      expect.anything(),
    );
  });

  it('no encola nada si el turno ya fue notificado por ambos canales (conflicto)', async () => {
    dataSource.query
      .mockResolvedValueOnce([
        { ...turnoBase, usuarioTelefonoCifrado: 'iv:tag:cifrado' },
      ])
      .mockResolvedValueOnce([]) // INSERT email -- ON CONFLICT DO NOTHING, sin filas
      .mockResolvedValueOnce([]); // INSERT whatsapp -- idem

    await service.programarRecordatorios();

    expect(cola.add).not.toHaveBeenCalled();
  });

  it('no rompe el resto si el telefono no se puede desencriptar', async () => {
    const { decrypt } = jest.requireMock('@turnos-platform/auth') as {
      decrypt: jest.Mock;
    };
    decrypt.mockImplementationOnce(() => {
      throw new Error('payload invalido');
    });

    dataSource.query
      .mockResolvedValueOnce([
        { ...turnoBase, usuarioTelefonoCifrado: 'dato-corrupto' },
      ])
      .mockResolvedValueOnce([{ id: 'notif-email' }]);

    await expect(service.programarRecordatorios()).resolves.toBeUndefined();

    expect(cola.add).toHaveBeenCalledTimes(1);
    expect(cola.add).toHaveBeenCalledWith(
      expect.objectContaining({ notificacionId: 'notif-email' }),
      expect.anything(),
    );
  });
});
