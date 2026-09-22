import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Job } from 'bull';
import { Repository } from 'typeorm';
import {
  CanalNotificacion,
  EstadoNotificacion,
  Notificacion,
} from './entities/notificacion.entity';
import { NotificacionJobData } from './notifications.constants';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationProvider } from './providers/notification-provider.interface';
import { EMAIL_PROVIDER, WHATSAPP_PROVIDER } from './providers/provider.tokens';

function crearJob(
  overrides: Partial<Job<NotificacionJobData>> = {},
): Job<NotificacionJobData> {
  return {
    data: { notificacionId: 'notif-1', mensaje: 'Recordatorio de prueba' },
    attemptsMade: 0,
    opts: { attempts: 3 },
    ...overrides,
  } as Job<NotificacionJobData>;
}

describe('NotificationsProcessor', () => {
  let processor: NotificationsProcessor;
  let repository: jest.Mocked<Repository<Notificacion>>;
  let emailProvider: jest.Mocked<NotificationProvider>;
  let whatsappProvider: jest.Mocked<NotificationProvider>;

  const notificacionEmail: Notificacion = {
    id: 'notif-1',
    turnoId: 't-1',
    canal: CanalNotificacion.EMAIL,
    destinatario: 'cliente@turnos.dev',
    tipo: 'recordatorio_24h',
    estado: EstadoNotificacion.PENDIENTE,
    intentos: 0,
    error: null,
    enviadoEn: null,
    creadoEn: new Date(),
    actualizadoEn: new Date(),
  };

  beforeEach(async () => {
    emailProvider = { enviar: jest.fn() };
    whatsappProvider = { enviar: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsProcessor,
        {
          provide: getRepositoryToken(Notificacion),
          useValue: { findOne: jest.fn(), update: jest.fn() },
        },
        { provide: EMAIL_PROVIDER, useValue: emailProvider },
        { provide: WHATSAPP_PROVIDER, useValue: whatsappProvider },
      ],
    }).compile();

    processor = module.get(NotificationsProcessor);
    repository = module.get(getRepositoryToken(Notificacion));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('marca la notificacion como enviada cuando el provider responde OK', async () => {
    repository.findOne.mockResolvedValue(notificacionEmail);

    await processor.procesar(crearJob());

    expect(emailProvider.enviar).toHaveBeenCalledWith({
      destinatario: 'cliente@turnos.dev',
      mensaje: 'Recordatorio de prueba',
    });
    expect(repository.update).toHaveBeenCalledWith(
      'notif-1',
      expect.objectContaining({ estado: EstadoNotificacion.ENVIADO }),
    );
  });

  it('usa el provider de whatsapp cuando el canal es whatsapp', async () => {
    repository.findOne.mockResolvedValue({
      ...notificacionEmail,
      canal: CanalNotificacion.WHATSAPP,
      destinatario: '+5491122334455',
    });

    await processor.procesar(crearJob());

    expect(whatsappProvider.enviar).toHaveBeenCalled();
    expect(emailProvider.enviar).not.toHaveBeenCalled();
  });

  it('propaga el error del provider caido para que Bull reintente', async () => {
    repository.findOne.mockResolvedValue(notificacionEmail);
    emailProvider.enviar.mockRejectedValue(new Error('SendGrid 503'));

    await expect(processor.procesar(crearJob())).rejects.toThrow(
      'SendGrid 503',
    );
    // No se marca nada como enviado ni como fallido aca: el estado lo
    // decide alFallar(), que sabe si quedan reintentos.
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('al fallar un intento intermedio solo actualiza intentos, sin marcar fallido', async () => {
    const job = crearJob({ attemptsMade: 1, opts: { attempts: 3 } });

    await processor.alFallar(job, new Error('Twilio timeout'));

    expect(repository.update).toHaveBeenCalledWith('notif-1', {
      intentos: 1,
    });
  });

  it('marca fallido recien cuando se agotaron los reintentos', async () => {
    const job = crearJob({ attemptsMade: 3, opts: { attempts: 3 } });

    await processor.alFallar(job, new Error('Twilio caido'));

    expect(repository.update).toHaveBeenCalledWith('notif-1', {
      intentos: 3,
      estado: EstadoNotificacion.FALLIDO,
      error: 'Twilio caido',
    });
  });

  it('no hace nada si la notificacion ya no existe', async () => {
    repository.findOne.mockResolvedValue(null);

    await processor.procesar(crearJob());

    expect(emailProvider.enviar).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });
});
