import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { decrypt } from '@turnos-platform/crypto';
import { Queue } from 'bull';
import { DataSource } from 'typeorm';
import { horaEnZona, zonaHorariaNegocio } from '../../common/zona-horaria.util';
import { CanalNotificacion } from './entities/notificacion.entity';
import {
  NOMBRE_COLA_NOTIFICACIONES,
  opcionesJobNotificacion,
} from './notifications.constants';

const HORAS_ANTICIPACION = 24;
const MARGEN_MINUTOS = 15;

interface TurnoParaRecordar {
  turnoId: string;
  inicio: Date;
  bahiaNombre: string;
  servicioNombre: string;
  usuarioEmail: string;
  usuarioTelefonoCifrado: string | null;
}

@Injectable()
export class NotificationsSchedulerService {
  private readonly logger = new Logger(NotificationsSchedulerService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectQueue(NOMBRE_COLA_NOTIFICACIONES) private readonly cola: Queue,
  ) {}

  // Corre cada 15 min buscando una banda de 30 min alrededor de "ahora+24h"
  // (no un instante exacto): si una corrida se atrasa o el proceso estuvo
  // caido, el turno igual entra en la ventana de la corrida siguiente. Esto
  // es seguro porque insertarSiNoExiste() usa la constraint UNIQUE de
  // notificaciones (turno_id, tipo, canal) para deduplicar -- ver
  // 008_create_notificaciones.sql. El cron nunca es la fuente de verdad de
  // "ya se mando o no", la DB si.
  @Cron('*/15 * * * *')
  async programarRecordatorios(): Promise<void> {
    const ahora = Date.now();
    const desde = new Date(
      ahora + (HORAS_ANTICIPACION * 60 - MARGEN_MINUTOS) * 60_000,
    );
    const hasta = new Date(
      ahora + (HORAS_ANTICIPACION * 60 + MARGEN_MINUTOS) * 60_000,
    );

    const turnos = await this.buscarTurnosParaRecordar(desde, hasta);
    for (const turno of turnos) {
      await this.encolarRecordatorio(turno);
    }
  }

  /**
   * Reconciliacion de cobertura (Sprint 9).
   *
   * El criterio de aceptacion del SRS pide que el 100% de las
   * notificaciones tenga estado registrado. Lo que la tabla NO puede
   * mostrar por si sola son los dos huecos:
   *
   * 1. Turnos inminentes SIN NINGUNA fila. El cron de arriba mira una
   *    ventana de 30 min alrededor de "ahora + 24 h" y corre cada 15, asi
   *    que las ventanas se solapan y un atraso corto se recupera solo. Pero
   *    si el proceso estuvo caido mas de 30 minutos, el turno atraviesa la
   *    ventana entero y no queda constancia de nada: no hay fila que diga
   *    "esta notificacion no se mando", simplemente no existe.
   *
   * 2. Filas 'pendiente' viejas. Si el worker murio entre el INSERT y el
   *    procesamiento, o Redis perdio la cola, la fila se queda en
   *    'pendiente' para siempre y nadie la reintenta.
   *
   * Esto no los arregla: los hace VISIBLES. Sale por el logger a nivel
   * error justamente para que el monitoreo pueda alertar sobre ello, en vez
   * de depender de que alguien corra las consultas a mano.
   */
  @Cron('*/30 * * * *')
  async verificarCobertura(): Promise<void> {
    const [sinNotificacion] = await this.dataSource.query(
      `SELECT count(*)::int AS total
       FROM turnos t
       LEFT JOIN notificaciones n ON n.turno_id = t.id
       WHERE lower(t.rango_tiempo) BETWEEN now() AND now() + interval '24 hours'
         AND t.estado = 'programado'
         AND t.usuario_id IS NOT NULL
         AND n.id IS NULL`,
    );

    const [pendientesViejas] = await this.dataSource.query(
      `SELECT count(*)::int AS total
       FROM notificaciones
       WHERE estado = 'pendiente'
         AND creado_en < now() - interval '1 hour'`,
    );

    if (sinNotificacion.total > 0) {
      this.logger.error(
        `Cobertura de recordatorios incompleta: ${sinNotificacion.total} turnos ` +
          'empiezan dentro de 24h y no tienen ninguna notificacion registrada.',
      );
    }

    if (pendientesViejas.total > 0) {
      this.logger.error(
        `${pendientesViejas.total} notificaciones llevan mas de 1h en estado ` +
          'pendiente: la cola no las proceso.',
      );
    }
  }

  private async buscarTurnosParaRecordar(
    desde: Date,
    hasta: Date,
  ): Promise<TurnoParaRecordar[]> {
    // JOIN crudo cruzando a usuarios (entidad de usuarios-service, no de
    // este servicio) -- mismo patron que tecnicos.util.ts: una sola
    // Postgres compartida entre los dos servicios.
    return this.dataSource.query(
      `SELECT t.id AS "turnoId",
              lower(t.rango_tiempo) AS inicio,
              b.nombre AS "bahiaNombre",
              s.nombre AS "servicioNombre",
              u.email AS "usuarioEmail",
              u.telefono AS "usuarioTelefonoCifrado"
       FROM turnos t
       JOIN bahias b ON b.id = t.bahia_id
       JOIN servicios s ON s.id = t.servicio_id
       JOIN usuarios u ON u.id = t.usuario_id
       WHERE lower(t.rango_tiempo) >= $1 AND lower(t.rango_tiempo) < $2`,
      [desde, hasta],
    );
  }

  private async encolarRecordatorio(turno: TurnoParaRecordar): Promise<void> {
    const mensaje = this.construirMensaje(turno);

    const emailId = await this.insertarSiNoExiste(
      turno.turnoId,
      CanalNotificacion.EMAIL,
      turno.usuarioEmail,
    );
    if (emailId) {
      await this.cola.add(
        { notificacionId: emailId, mensaje },
        opcionesJobNotificacion(),
      );
    }

    if (!turno.usuarioTelefonoCifrado) {
      return;
    }

    // telefono se guarda cifrado desde Sprint 2 (encryptedColumnTransformer
    // en usuarios-service); la query cruda de arriba trae el texto cifrado
    // tal cual, asi que hay que desencriptarlo aca con la misma
    // ENCRYPTION_KEY (ahora tambien en el .env de reservas-service).
    let telefono: string;
    try {
      telefono = decrypt(turno.usuarioTelefonoCifrado);
    } catch (error) {
      this.logger.error(
        `No se pudo desencriptar el telefono del turno ${turno.turnoId}`,
        error as Error,
      );
      return;
    }

    const whatsappId = await this.insertarSiNoExiste(
      turno.turnoId,
      CanalNotificacion.WHATSAPP,
      telefono,
    );
    if (whatsappId) {
      await this.cola.add(
        { notificacionId: whatsappId, mensaje },
        opcionesJobNotificacion(),
      );
    }
  }

  private async insertarSiNoExiste(
    turnoId: string,
    canal: CanalNotificacion,
    destinatario: string,
  ): Promise<string | null> {
    const filas: { id: string }[] = await this.dataSource.query(
      `INSERT INTO notificaciones (turno_id, canal, destinatario)
       VALUES ($1, $2, $3)
       ON CONFLICT (turno_id, tipo, canal) DO NOTHING
       RETURNING id`,
      [turnoId, canal, destinatario],
    );
    return filas[0]?.id ?? null;
  }

  private construirMensaje(turno: TurnoParaRecordar): string {
    // Hora del taller: es la que el cliente tiene que mirar en su reloj.
    const hora = horaEnZona(turno.inicio, zonaHorariaNegocio());
    return `Recordatorio: tenes un turno manana a las ${hora} en ${turno.bahiaNombre} para ${turno.servicioNombre}.`;
  }
}
