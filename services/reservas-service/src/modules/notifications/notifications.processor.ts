import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bull';
import { Repository } from 'typeorm';
import {
  CanalNotificacion,
  EstadoNotificacion,
  Notificacion,
} from './entities/notificacion.entity';
import {
  NOMBRE_COLA_NOTIFICACIONES,
  NotificacionJobData,
} from './notifications.constants';
import { NotificationProvider } from './providers/notification-provider.interface';
import { EMAIL_PROVIDER, WHATSAPP_PROVIDER } from './providers/provider.tokens';

@Processor(NOMBRE_COLA_NOTIFICACIONES)
export class NotificationsProcessor {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    @InjectRepository(Notificacion)
    private readonly notificacionesRepository: Repository<Notificacion>,
    @Inject(EMAIL_PROVIDER)
    private readonly emailProvider: NotificationProvider,
    @Inject(WHATSAPP_PROVIDER)
    private readonly whatsappProvider: NotificationProvider,
  ) {}

  @Process()
  async procesar(job: Job<NotificacionJobData>): Promise<void> {
    const notificacion = await this.notificacionesRepository.findOne({
      where: { id: job.data.notificacionId },
    });
    if (!notificacion) {
      // Fila borrada o inexistente: no hay nada que reintentar.
      return;
    }

    const provider =
      notificacion.canal === CanalNotificacion.WHATSAPP
        ? this.whatsappProvider
        : this.emailProvider;

    // Si esto tira, NO se atrapa aca a proposito: Bull decide reintentar
    // (o no) segun OPCIONES_JOB_NOTIFICACION, y el estado en DB solo se
    // actualiza en alFallar() -- ver el comentario ahi sobre por que.
    await provider.enviar({
      destinatario: notificacion.destinatario,
      mensaje: job.data.mensaje,
      ...(job.data.asunto ? { asunto: job.data.asunto } : {}),
    });

    await this.notificacionesRepository.update(notificacion.id, {
      estado: EstadoNotificacion.ENVIADO,
      enviadoEn: new Date(),
    });
  }

  // El evento 'failed' de una queue de Bull se dispara en CADA intento
  // fallido, no solo en el ultimo -- confirmado leyendo el source instalado
  // (bull@4.16.5, lib/queue.js: handleFailed llama a job.moveToFailed() y
  // emite 'failed' incondicionalmente en cualquier rechazo del processor;
  // lib/job.js: attemptsMade se incrementa ANTES de decidir si el job se
  // reintenta o se da por perdido). Por eso hay que comparar
  // job.attemptsMade contra job.opts.attempts aca: si no, la notificacion
  // quedaria marcada 'fallido' en el primer intento aunque Bull la vaya a
  // reintentar solo despues.
  @OnQueueFailed()
  async alFallar(job: Job<NotificacionJobData>, error: Error): Promise<void> {
    const intentosMaximos = job.opts.attempts ?? 1;
    const agotado = job.attemptsMade >= intentosMaximos;

    // El try/catch NO es defensivo por costumbre: este handler corre fuera
    // del ciclo de vida de un request, disparado por Bull cuando le llega el
    // fallo. Si el modulo ya se esta destruyendo -- un pod que recibe
    // SIGTERM durante un rolling update, o un test que cerro su app -- la
    // conexion de TypeORM puede estar cerrada y este update rechaza con
    // "Driver not Connected". Al no haber nadie esperando esa promesa, seria
    // una unhandled rejection: Node tumba el proceso.
    //
    // Perder la actualizacion de estado de una notificacion es molesto (la
    // fila queda en 'pendiente' y la detecta verificarCobertura); tumbar el
    // proceso durante cada deploy es mucho peor.
    try {
      await this.notificacionesRepository.update(job.data.notificacionId, {
        intentos: job.attemptsMade,
        ...(agotado
          ? { estado: EstadoNotificacion.FALLIDO, error: error.message }
          : {}),
      });
    } catch (fallo) {
      this.logger.warn(
        `No se pudo registrar el fallo de la notificacion ` +
          `${job.data.notificacionId}: ${(fallo as Error).message}`,
      );
    }
  }
}
