import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContextoDb } from '@turnos-platform/tenant';
import { DataSource, QueryFailedError } from 'typeorm';
import { STRIKES_PARA_PREPAGO } from '../../common/politica-cancelacion.util';
import {
  AnularStrikeDto,
  PoliticaDto,
  ResolverReclamoDto,
  StrikesQueryDto,
} from './dto/politica.dto';

export type MotivoStrike =
  'cancelacion_tardia' | 'reprogramacion_tardia' | 'no_asistio';

export interface Politica {
  ventanaHoras: number;
  vigenciaStrikesMeses: number;
  strikesParaPrepago: number;
}

/** Politica + como esta un cliente en este taller. */
export interface PoliticaCliente extends Politica {
  strikesVigentes: number;
  /** Con STRIKES_PARA_PREPAGO vigentes: reserva solo pagando el 100%. */
  requierePrepago: boolean;
}

export type EstadoStrike = 'vigente' | 'vencido' | 'anulado';

export interface Strike {
  id: string;
  motivo: MotivoStrike;
  detalle: string;
  creadoEn: string;
  venceEn: string;
  estado: EstadoStrike;
  anulacion: { en: string; justificacion: string } | null;
  turno: { id: string; inicio: string; servicio: string };
  taller: { id: string; nombre: string };
  /** Solo en la vista del taller. */
  cliente?: { id: string; nombre: string; email: string };
  reclamo: {
    texto: string;
    creadoEn: string;
    resultado: 'aceptado' | 'rechazado' | null;
    respuesta: string | null;
    resueltoEn: string | null;
  } | null;
}

interface FilaStrike {
  id: string;
  motivo: MotivoStrike;
  detalle: string;
  creadoEn: Date;
  venceEn: Date;
  anuladoEn: Date | null;
  justificacion: string | null;
  turnoId: string;
  turnoInicio: Date;
  servicio: string;
  tallerId: string;
  tallerNombre: string | null;
  clienteId: string;
  clienteNombre: string | null;
  clienteEmail: string | null;
  reclamoTexto: string | null;
  reclamoEn: Date | null;
  reclamoResultado: 'aceptado' | 'rechazado' | null;
  reclamoRespuesta: string | null;
  reclamoResueltoEn: Date | null;
}

const SQL_STRIKES = `
  SELECT s.id, s.motivo, s.detalle,
         s.creado_en    AS "creadoEn",
         s.vence_en     AS "venceEn",
         s.anulado_en   AS "anuladoEn",
         s.justificacion_anulacion AS justificacion,
         t.id           AS "turnoId",
         lower(t.rango_tiempo) AS "turnoInicio",
         sv.nombre      AS servicio,
         s.taller_id    AS "tallerId",
         ta.nombre      AS "tallerNombre",
         s.usuario_id   AS "clienteId",
         u.nombre       AS "clienteNombre",
         u.email        AS "clienteEmail",
         r.texto        AS "reclamoTexto",
         r.creado_en    AS "reclamoEn",
         r.resultado    AS "reclamoResultado",
         r.respuesta    AS "reclamoRespuesta",
         r.resuelto_en  AS "reclamoResueltoEn"
    FROM strikes s
    JOIN turnos t     ON t.id = s.turno_id
    JOIN servicios sv ON sv.id = t.servicio_id
    LEFT JOIN talleres ta ON ta.id = s.taller_id
    LEFT JOIN usuarios u ON u.id = s.usuario_id
    LEFT JOIN reclamos_strike r ON r.strike_id = s.id`;

function iso(d: Date | null): string | null {
  return d ? new Date(d).toISOString() : null;
}

/**
 * Politica de cancelacion y strikes (Sprint 22). Los strikes son por
 * taller: el conteo, el bloqueo y la anulacion miran siempre un taller.
 */
@Injectable()
export class PoliticaService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly db: ContextoDb,
  ) {}

  private consultar<T>(sql: string, params: unknown[]): Promise<T> {
    return this.db.query(sql, params, this.dataSource) as Promise<T>;
  }

  async obtener(tallerId: string = this.db.exigirTaller()): Promise<Politica> {
    const [fila] = await this.consultar<
      { ventanaHoras: number; vigenciaStrikesMeses: number }[]
    >(
      `SELECT ventana_horas AS "ventanaHoras",
              vigencia_strikes_meses AS "vigenciaStrikesMeses"
         FROM politica_cancelacion WHERE taller_id = $1`,
      [tallerId],
    );
    // Sin fila (no deberia: la crea el alta del taller) rige el default.
    return {
      ventanaHoras: fila?.ventanaHoras ?? 4,
      vigenciaStrikesMeses: fila?.vigenciaStrikesMeses ?? 12,
      strikesParaPrepago: STRIKES_PARA_PREPAGO,
    };
  }

  async actualizar(dto: PoliticaDto): Promise<Politica> {
    const taller = this.db.exigirTaller();
    await this.consultar(
      `UPDATE politica_cancelacion
          SET ventana_horas = $2, vigencia_strikes_meses = $3,
              actualizado_en = now()
        WHERE taller_id = $1`,
      [taller, dto.ventanaHoras, dto.vigenciaStrikesMeses],
    );
    return this.obtener(taller);
  }

  /** Strikes que cuentan hoy: ni vencidos ni anulados. */
  async strikesVigentes(tallerId: string, usuarioId: string): Promise<number> {
    const [fila] = await this.consultar<{ total: number }[]>(
      `SELECT count(*)::int AS total FROM strikes
        WHERE taller_id = $1 AND usuario_id = $2
          AND anulado_en IS NULL AND vence_en > now()`,
      [tallerId, usuarioId],
    );
    return fila.total;
  }

  async paraCliente(usuarioId: string): Promise<PoliticaCliente> {
    const taller = this.db.exigirTaller();
    const politica = await this.obtener(taller);
    const strikesVigentes = await this.strikesVigentes(taller, usuarioId);
    return {
      ...politica,
      strikesVigentes,
      requierePrepago: strikesVigentes >= STRIKES_PARA_PREPAGO,
    };
  }

  /**
   * Un turno suma a lo sumo un strike (UNIQUE turno_id): si ya tiene, no
   * hace nada. Vence con la vigencia de HOY de la politica.
   */
  async registrarStrike(args: {
    tallerId: string;
    usuarioId: string;
    turnoId: string;
    motivo: MotivoStrike;
    detalle: string;
  }): Promise<string | null> {
    const filas = await this.consultar<{ id: string }[]>(
      `INSERT INTO strikes (taller_id, usuario_id, turno_id, motivo, detalle, vence_en)
       SELECT $1, $2, $3, $4, $5,
              now() + make_interval(months => p.vigencia_strikes_meses)
         FROM politica_cancelacion p WHERE p.taller_id = $1
       ON CONFLICT (turno_id) DO NOTHING
       RETURNING id`,
      [args.tallerId, args.usuarioId, args.turnoId, args.motivo, args.detalle],
    );
    return filas[0]?.id ?? null;
  }

  /**
   * Se corrigio el cierre de un turno que estaba como no_asistio: su
   * strike deja de tener fundamento. Se anula (no se borra: el cliente ve
   * que existio y por que se quito).
   */
  async anularPorCorreccion(
    turnoId: string,
    adminId: string,
    justificacion: string,
  ): Promise<void> {
    await this.consultar(
      `UPDATE strikes
          SET anulado_en = now(), anulado_por = $2, justificacion_anulacion = $3
        WHERE turno_id = $1 AND anulado_en IS NULL`,
      [turnoId, adminId, justificacion],
    );
  }

  // --------------------------------------------------------------- listas

  private presentar(f: FilaStrike, conCliente: boolean): Strike {
    const estado: EstadoStrike = f.anuladoEn
      ? 'anulado'
      : new Date(f.venceEn).getTime() <= Date.now()
        ? 'vencido'
        : 'vigente';
    return {
      id: f.id,
      motivo: f.motivo,
      detalle: f.detalle,
      creadoEn: iso(f.creadoEn)!,
      venceEn: iso(f.venceEn)!,
      estado,
      anulacion: f.anuladoEn
        ? { en: iso(f.anuladoEn)!, justificacion: f.justificacion ?? '' }
        : null,
      turno: {
        id: f.turnoId,
        inicio: iso(f.turnoInicio)!,
        servicio: f.servicio,
      },
      // LEFT JOIN: un taller dado de baja no le esconde al cliente sus strikes.
      taller: { id: f.tallerId, nombre: f.tallerNombre ?? '' },
      ...(conCliente
        ? {
            cliente: {
              id: f.clienteId,
              nombre: f.clienteNombre ?? '',
              email: f.clienteEmail ?? '',
            },
          }
        : {}),
      reclamo: f.reclamoTexto
        ? {
            texto: f.reclamoTexto,
            creadoEn: iso(f.reclamoEn)!,
            resultado: f.reclamoResultado,
            respuesta: f.reclamoRespuesta,
            resueltoEn: iso(f.reclamoResueltoEn),
          }
        : null,
    };
  }

  /** Los del cliente, en todos los talleres (su perfil). */
  async misStrikes(usuarioId: string): Promise<Strike[]> {
    const filas = await this.consultar<FilaStrike[]>(
      `${SQL_STRIKES}
        WHERE s.usuario_id = $1
        ORDER BY s.creado_en DESC
        LIMIT 200`,
      [usuarioId],
    );
    return filas.map((f) => this.presentar(f, false));
  }

  /** Los del taller (admin). */
  async listarTaller(query: StrikesQueryDto): Promise<Strike[]> {
    const taller = this.db.exigirTaller();
    const condiciones = ['s.taller_id = $1'];
    const params: unknown[] = [taller];
    const estado = query.estado ?? 'vigentes';
    if (estado === 'reclamos') {
      condiciones.push('r.strike_id IS NOT NULL AND r.resultado IS NULL');
    } else if (estado === 'vigentes') {
      condiciones.push('s.anulado_en IS NULL AND s.vence_en > now()');
    } else {
      condiciones.push(`s.creado_en > now() - interval '18 months'`);
    }
    if (query.clienteId) {
      params.push(query.clienteId);
      condiciones.push(`s.usuario_id = $${params.length}`);
    }
    const filas = await this.consultar<FilaStrike[]>(
      `${SQL_STRIKES}
        WHERE ${condiciones.join(' AND ')}
        ORDER BY s.creado_en DESC
        LIMIT 500`,
      params,
    );
    return filas.map((f) => this.presentar(f, true));
  }

  private async unoDelTaller(id: string): Promise<FilaStrike> {
    const taller = this.db.exigirTaller();
    const [fila] = await this.consultar<FilaStrike[]>(
      `${SQL_STRIKES} WHERE s.id = $1 AND s.taller_id = $2`,
      [id, taller],
    );
    if (!fila) throw new NotFoundException(`Strike ${id} no encontrado`);
    return fila;
  }

  async anular(
    id: string,
    dto: AnularStrikeDto,
    adminId: string,
  ): Promise<Strike> {
    const actual = await this.unoDelTaller(id);
    if (actual.anuladoEn) {
      throw new ConflictException('Ese strike ya estaba anulado.');
    }
    const justificacion = dto.justificacion.trim();
    await this.consultar(
      `UPDATE strikes
          SET anulado_en = now(), anulado_por = $2, justificacion_anulacion = $3
        WHERE id = $1`,
      [id, adminId, justificacion],
    );
    // Un reclamo pendiente queda respondido: el admin le dio la razon.
    await this.consultar(
      `UPDATE reclamos_strike
          SET resultado = 'aceptado', respuesta = $2, resuelto_en = now(),
              resuelto_por = $3
        WHERE strike_id = $1 AND resultado IS NULL`,
      [id, justificacion, adminId],
    );
    return this.presentar(await this.unoDelTaller(id), true);
  }

  async resolverReclamo(
    id: string,
    dto: ResolverReclamoDto,
    adminId: string,
  ): Promise<Strike> {
    const actual = await this.unoDelTaller(id);
    if (!actual.reclamoTexto || actual.reclamoResultado) {
      throw new BadRequestException(
        'Ese strike no tiene un reclamo pendiente.',
      );
    }
    if (dto.aceptar) {
      return this.anular(id, { justificacion: dto.respuesta }, adminId);
    }
    await this.consultar(
      `UPDATE reclamos_strike
          SET resultado = 'rechazado', respuesta = $2, resuelto_en = now(),
              resuelto_por = $3
        WHERE strike_id = $1 AND resultado IS NULL`,
      [id, dto.respuesta.trim(), adminId],
    );
    return this.presentar(await this.unoDelTaller(id), true);
  }

  /** El cliente reclama uno de sus strikes (uno por strike). */
  async reclamar(
    id: string,
    texto: string,
    usuarioId: string,
  ): Promise<Strike> {
    // RLS: el cliente solo ve los suyos; el filtro por usuario igual va,
    // porque el personal del taller tambien ve los del taller.
    const [fila] = await this.consultar<FilaStrike[]>(
      `${SQL_STRIKES} WHERE s.id = $1 AND s.usuario_id = $2`,
      [id, usuarioId],
    );
    if (!fila) throw new NotFoundException(`Strike ${id} no encontrado`);
    if (fila.anuladoEn) {
      throw new BadRequestException('Ese strike ya fue anulado.');
    }
    if (fila.reclamoTexto) {
      throw new ConflictException(
        'Ya reclamaste ese strike. El taller te responde por aca.',
      );
    }
    try {
      await this.db.conSavepoint(() =>
        this.consultar(
          `INSERT INTO reclamos_strike (strike_id, taller_id, usuario_id, texto)
           VALUES ($1, $2, $3, $4)`,
          [id, fila.tallerId, usuarioId, texto.trim()],
        ),
      );
    } catch (error) {
      const codigo = (error as { driverError?: { code?: string } }).driverError
        ?.code;
      if (error instanceof QueryFailedError && codigo === '23505') {
        throw new ConflictException('Ya reclamaste ese strike.');
      }
      throw error;
    }
    const [actualizado] = await this.consultar<FilaStrike[]>(
      `${SQL_STRIKES} WHERE s.id = $1`,
      [id],
    );
    return this.presentar(actualizado, false);
  }
}
