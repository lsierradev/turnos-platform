import { InjectQueue } from '@nestjs/bull';
import { Injectable } from '@nestjs/common';
import { ContextoDb } from '@turnos-platform/tenant';
import { Queue } from 'bull';
import { DataSource } from 'typeorm';
import { CanalNotificacion } from './entities/notificacion.entity';
import {
  NOMBRE_COLA_NOTIFICACIONES,
  opcionesJobNotificacion,
} from './notifications.constants';

/**
 * Correos que dispara una accion del request (Sprint 22: la constancia de
 * recepcion), por la misma cola y tabla que los recordatorios: quedan con
 * estado, reintentos y el control de cobertura.
 *
 * La fila se escribe en la transaccion del request; el job se encola
 * recien despues del COMMIT (ContextoDb.despuesDeConfirmar). Si se
 * encolara antes, el worker podria buscar una fila que todavia no existe
 * para el (y darla por borrada), o el request fallar despues y el correo
 * confirmar algo que no quedo guardado.
 */
@Injectable()
export class CorreosService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly db: ContextoDb,
    @InjectQueue(NOMBRE_COLA_NOTIFICACIONES) private readonly cola: Queue,
  ) {}

  /**
   * @returns false si ya existia una notificacion de ese tipo para el
   *   turno (UNIQUE turno_id, tipo, canal de 008): no se manda dos veces.
   */
  async encolar(args: {
    turnoId: string;
    tipo: string;
    destinatario: string;
    asunto: string;
    mensaje: string;
  }): Promise<boolean> {
    const filas = (await this.db.query(
      `INSERT INTO notificaciones (turno_id, canal, destinatario, tipo, taller_id)
       SELECT $1, $2, $3, $4, t.taller_id FROM turnos t WHERE t.id = $1
       ON CONFLICT (turno_id, tipo, canal) DO NOTHING
       RETURNING id`,
      [args.turnoId, CanalNotificacion.EMAIL, args.destinatario, args.tipo],
      this.dataSource,
    )) as { id: string }[];
    const id = filas[0]?.id;
    if (!id) return false;
    this.db.despuesDeConfirmar(async () => {
      await this.cola.add(
        { notificacionId: id, mensaje: args.mensaje, asunto: args.asunto },
        opcionesJobNotificacion(),
      );
    });
    return true;
  }
}
