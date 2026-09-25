import { Injectable } from '@nestjs/common';
import { ContextoDb } from '@turnos-platform/tenant';
import { DataSource } from 'typeorm';
import {
  HorarioTaller,
  horaAMinutos,
  horarioPorDefecto,
  Jornada,
} from '../../common/horario.util';

/**
 * Lee el horario del taller de la sesion (Sprint 21). Sin taller (modo
 * sistema, tests unitarios) rige el horario historico: todos los dias,
 * 08:00-18:00.
 */
@Injectable()
export class HorarioService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly db: ContextoDb,
  ) {}

  /**
   * @param desde,hasta rango de fechas (YYYY-MM-DD, inclusive) del que hacen
   *   falta los festivos. La semana se trae entera siempre.
   */
  async obtener(
    desde: string,
    hasta: string,
    tallerId: string | null = this.db.tallerActual(),
  ): Promise<HorarioTaller> {
    if (!tallerId) return horarioPorDefecto();

    // En serie: las dos van por la misma conexion (la transaccion del request).
    const dias = (await this.db.query(
      `SELECT dia_semana AS dia,
                to_char(apertura, 'HH24:MI') AS apertura,
                to_char(cierre, 'HH24:MI') AS cierre
           FROM horarios_taller WHERE taller_id = $1`,
      [tallerId],
      this.dataSource,
    )) as { dia: number; apertura: string; cierre: string }[];
    const feriados = (await this.db.query(
      `SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, motivo
           FROM feriados_taller
          WHERE taller_id = $1 AND fecha BETWEEN $2::date AND $3::date`,
      [tallerId, desde, hasta],
      this.dataSource,
    )) as { fecha: string; motivo: string }[];

    const semana = new Map<number, Jornada>();
    for (const d of dias) {
      semana.set(Number(d.dia), {
        apertura: horaAMinutos(d.apertura),
        cierre: horaAMinutos(d.cierre),
      });
    }
    return {
      semana,
      feriados: new Map(feriados.map((f) => [f.fecha, f.motivo])),
    };
  }
}
