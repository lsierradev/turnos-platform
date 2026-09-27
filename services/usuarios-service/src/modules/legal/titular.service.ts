import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ContextoDb } from '@turnos-platform/tenant';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { ContrasenaService } from '../usuarios/contrasena.service';
import { RolUsuario, Usuario } from '../usuarios/entities/usuario.entity';
import { Aceptacion, LegalService, Origen } from './legal.service';

export interface Perfil {
  id: string;
  email: string;
  nombre: string;
  rol: RolUsuario;
  telefono: string | null;
  ciudad: string | null;
  creadoEn: Date;
}

export interface Solicitud {
  id: string;
  tipo: 'exportacion' | 'rectificacion' | 'supresion';
  detalle: Record<string, unknown>;
  creadoEn: string;
}

export interface MisDatos {
  perfil: Perfil;
  resumen: {
    vehiculos: number;
    turnos: number;
    recepciones: number;
    strikes: number;
  };
  aceptaciones: Aceptacion[];
  solicitudes: Solicitud[];
  supresion: { posible: boolean; motivo: string | null };
}

export interface Rectificacion {
  nombre?: string;
  telefono?: string;
  ciudad?: string;
}

/**
 * Lo que la supresion conserva y por que (se le muestra al titular antes
 * de confirmar y queda en la solicitud). Los plazos exactos los confirma
 * el abogado (ver docs/legal/PENDIENTES.md).
 */
export const CONSERVADO_AL_SUPRIMIR = [
  'Turnos con sus precios y anticipos, sin tus datos de contacto: soporte contable de cada taller.',
  'Constancias de recepcion y ordenes de trabajo, con la placa del vehiculo: garantia y proteccion al consumidor.',
  'Registro de tus aceptaciones: prueba de la autorizacion que diste.',
];

const NOMBRE_SUPRIMIDO = 'Titular suprimido';

/**
 * Derechos del titular (Sprint 23, Ley 1581 de 2012, articulo 8):
 * consultar, rectificar, exportar y suprimir los datos propios.
 *
 * Todo filtra por el usuario de la sesion de forma EXPLICITA ademas de
 * RLS: las politicas dejan ver al personal los datos de los clientes de su
 * taller, y "mis datos" de un admin no son los de sus clientes.
 */
@Injectable()
export class TitularService {
  constructor(
    @InjectRepository(Usuario)
    private readonly usuarios: Repository<Usuario>,
    private readonly db: ContextoDb,
    private readonly legal: LegalService,
  ) {}

  async consultar(usuarioId: string): Promise<MisDatos> {
    const perfil = await this.perfil(usuarioId);
    const [resumen] = await this.db.query<MisDatos['resumen'][]>(
      `SELECT
         (SELECT count(*)::int FROM vehiculos WHERE usuario_id = $1 AND activo) AS vehiculos,
         (SELECT count(*)::int FROM turnos WHERE usuario_id = $1) AS turnos,
         (SELECT count(*)::int FROM recepciones r JOIN turnos t ON t.id = r.turno_id
           WHERE t.usuario_id = $1) AS recepciones,
         (SELECT count(*)::int FROM strikes WHERE usuario_id = $1) AS strikes`,
      [usuarioId],
    );
    return {
      perfil,
      resumen,
      aceptaciones: await this.legal.mias(usuarioId),
      solicitudes: await this.solicitudes(usuarioId),
      supresion: await this.puedeSuprimir(perfil),
    };
  }

  async rectificar(
    usuarioId: string,
    cambios: Rectificacion,
    origen: Origen,
  ): Promise<Perfil> {
    const repo = this.db.repo(Usuario, this.usuarios);
    const usuario = await repo.findOne({ where: { id: usuarioId } });
    if (!usuario) throw new NotFoundException('Usuario no encontrado.');

    const campos: string[] = [];
    if (
      cambios.nombre !== undefined &&
      cambios.nombre.trim() !== usuario.nombre
    ) {
      usuario.nombre = cambios.nombre.trim();
      campos.push('nombre');
    }
    if (cambios.telefono !== undefined) {
      const telefono = cambios.telefono.trim() || null;
      if (telefono !== (usuario.telefono ?? null)) {
        usuario.telefono = telefono;
        campos.push('telefono');
      }
    }
    if (cambios.ciudad !== undefined) {
      const ciudad = cambios.ciudad.trim() || null;
      if (ciudad !== (usuario.ciudad ?? null)) {
        usuario.ciudad = ciudad;
        campos.push('ciudad');
      }
    }
    if (campos.length) {
      await repo.save(usuario);
      // Solo QUE cambio, no los valores: la traza no tiene que duplicar
      // datos personales (ni guardar los viejos que se pidio corregir).
      await this.registrarSolicitud(
        usuarioId,
        'rectificacion',
        { campos },
        origen,
      );
    }
    return this.perfil(usuarioId);
  }

  /**
   * Copia de todo lo que hay del titular, en JSON: perfil, vehiculos,
   * turnos en todos los talleres, recepciones (con fotos), strikes y
   * reclamos, notificaciones, aceptaciones y solicitudes.
   */
  async exportar(usuarioId: string, origen: Origen) {
    const q = <T>(sql: string) => this.db.query<T[]>(sql, [usuarioId]);
    const perfil = await this.perfil(usuarioId);

    const vehiculos = await q(
      `SELECT placa, marca, modelo, anio, kilometraje, activo,
              creado_en AS "creadoEn"
         FROM vehiculos WHERE usuario_id = $1 ORDER BY creado_en`,
    );
    const turnos = await q(
      `SELECT t.id, ta.nombre AS taller, s.nombre AS servicio, b.nombre AS bahia,
              lower(t.rango_tiempo) AS inicio, upper(t.rango_tiempo) AS fin,
              t.estado, v.placa AS vehiculo,
              t.total_centavos AS "totalCentavos", t.iva_centavos AS "ivaCentavos",
              t.anticipo_centavos AS "anticipoCentavos",
              t.cancelado_por AS "canceladoPor", t.cancelado_en AS "canceladoEn",
              t.motivo_cancelacion AS "motivoCancelacion",
              t.notas_atencion AS "notasAtencion",
              t.garantia_hasta AS "garantiaHasta", t.creado_en AS "creadoEn"
         FROM turnos t
         LEFT JOIN talleres ta ON ta.id = t.taller_id
         LEFT JOIN servicios s ON s.id = t.servicio_id
         LEFT JOIN bahias b ON b.id = t.bahia_id
         LEFT JOIN vehiculos v ON v.id = t.vehiculo_id
        WHERE t.usuario_id = $1
        ORDER BY lower(t.rango_tiempo)`,
    );
    const recepciones = await q<{ id: string }>(
      `SELECT r.id, r.turno_id AS "turnoId", ta.nombre AS taller, r.numero,
              r.kilometraje, r.nivel_combustible AS "nivelCombustible",
              r.estado_vehiculo AS "estadoVehiculo",
              r.objetos_dejados AS "objetosDejados", r.observaciones,
              r.fecha_probable_entrega AS "fechaProbableEntrega",
              r.creado_en AS "creadoEn", r.aceptada_en AS "aceptadaEn",
              r.aceptada_medio AS "aceptadaMedio",
              r.aceptada_nombre AS "aceptadaNombre",
              r.aceptada_documento AS "aceptadaDocumento"
         FROM recepciones r
         JOIN turnos t ON t.id = r.turno_id
         LEFT JOIN talleres ta ON ta.id = r.taller_id
        WHERE t.usuario_id = $1
        ORDER BY r.creado_en`,
    );
    const fotos = await q<{ recepcionId: string; dataUrl: string }>(
      `SELECT f.recepcion_id AS "recepcionId",
              'data:' || f.tipo_mime || ';base64,' || encode(f.datos, 'base64') AS "dataUrl"
         FROM recepcion_fotos f
         JOIN recepciones r ON r.id = f.recepcion_id
         JOIN turnos t ON t.id = r.turno_id
        WHERE t.usuario_id = $1
        ORDER BY f.creado_en`,
    );
    const strikes = await q(
      `SELECT ta.nombre AS taller, s.turno_id AS "turnoId", s.motivo, s.detalle,
              s.creado_en AS "creadoEn", s.vence_en AS "venceEn",
              s.anulado_en AS "anuladoEn",
              s.justificacion_anulacion AS "justificacionAnulacion",
              r.texto AS "reclamo", r.resultado AS "reclamoResultado",
              r.respuesta AS "reclamoRespuesta"
         FROM strikes s
         LEFT JOIN talleres ta ON ta.id = s.taller_id
         LEFT JOIN reclamos_strike r ON r.strike_id = s.id
        WHERE s.usuario_id = $1
        ORDER BY s.creado_en`,
    );
    // RLS no deja al cliente leer notificaciones (son del taller): modo
    // sistema, con el filtro por titular explicito.
    const notificaciones = await this.db.sistema((m) =>
      m.query(
        `SELECT n.turno_id AS "turnoId", n.canal, n.tipo, n.destinatario,
                n.estado, n.creado_en AS "creadoEn", n.enviado_en AS "enviadoEn"
           FROM notificaciones n
           JOIN turnos t ON t.id = n.turno_id
          WHERE t.usuario_id = $1
          ORDER BY n.creado_en`,
        [usuarioId],
      ),
    );

    await this.registrarSolicitud(usuarioId, 'exportacion', {}, origen);

    return {
      generadoEn: new Date().toISOString(),
      aviso:
        'Copia de tus datos personales en TurnoPro (Ley 1581 de 2012). ' +
        'Los valores en centavos son pesos colombianos x 100.',
      perfil,
      vehiculos,
      turnos,
      recepciones: recepciones.map((r) => ({
        ...r,
        fotos: fotos
          .filter((f) => f.recepcionId === r.id)
          .map((f) => f.dataUrl),
      })),
      strikes,
      notificaciones,
      aceptaciones: await this.legal.mias(usuarioId),
      solicitudes: await this.solicitudes(usuarioId),
    };
  }

  /**
   * Supresion: la cuenta deja de existir para todo efecto practico, y se
   * conserva lo que la ley obliga a guardar (CONSERVADO_AL_SUPRIMIR), ya
   * sin nombre, correo, telefono ni ciudad.
   *
   * No se borra la fila de usuarios: la nombran turnos, recepciones y
   * aceptaciones que hay que conservar. Se anonimiza y se desactiva (el
   * login y el refresh ya rechazan cuentas inactivas).
   */
  async suprimir(
    usuarioId: string,
    password: string,
    origen: Origen,
  ): Promise<{ conservado: string[] }> {
    const usuario = await this.db.sistema((m) =>
      m.getRepository(Usuario).findOne({ where: { id: usuarioId } }),
    );
    if (!usuario || usuario.suprimidoEn) {
      throw new NotFoundException('Usuario no encontrado.');
    }
    // Pedir la contrasena: una sesion abierta en una computadora del
    // taller no puede borrar la cuenta de nadie. 403 y no 401: el panel
    // trata un 401 como sesion vencida y cerraria la sesion por un error
    // de tipeo.
    if (!(await bcrypt.compare(password, usuario.passwordHash))) {
      throw new ForbiddenException('La contraseña no es correcta.');
    }
    const { posible, motivo } = await this.puedeSuprimir(usuario);
    if (!posible) {
      throw usuario.rol === RolUsuario.CLIENTE
        ? new ConflictException(motivo)
        : new ForbiddenException(motivo);
    }

    const hashNuevo = await ContrasenaService.hashInicial();
    // Modo sistema: borra filas que RLS no le deja tocar al cliente
    // (strikes, relaciones con talleres, notificaciones). Cada sentencia
    // filtra por el titular verificado arriba.
    await this.db.sistema(async (m) => {
      const id = [usuarioId];
      await m.query(
        `INSERT INTO solicitudes_titular (usuario_id, tipo, detalle, ip)
         VALUES ($1, 'supresion', $2, $3)`,
        [usuarioId, { conservado: CONSERVADO_AL_SUPRIMIR }, origen.ip],
      );
      await m.query('DELETE FROM reclamos_strike WHERE usuario_id = $1', id);
      await m.query('DELETE FROM strikes WHERE usuario_id = $1', id);
      // Los vehiculos que figuran en un turno o una recepcion se quedan
      // (la orden de trabajo los nombra); el resto se borra.
      await m.query(
        `DELETE FROM vehiculos v
          WHERE v.usuario_id = $1
            AND NOT EXISTS (SELECT 1 FROM turnos t WHERE t.vehiculo_id = v.id)
            AND NOT EXISTS (SELECT 1 FROM recepciones r WHERE r.vehiculo_id = v.id)`,
        id,
      );
      await m.query(
        `UPDATE vehiculos SET activo = false, actualizado_en = now()
          WHERE usuario_id = $1`,
        id,
      );
      await m.query(
        `UPDATE notificaciones SET destinatario = '[suprimido]', actualizado_en = now()
          WHERE turno_id IN (SELECT id FROM turnos WHERE usuario_id = $1)`,
        id,
      );
      await m.query('DELETE FROM clientes_taller WHERE usuario_id = $1', id);
      await m.query('DELETE FROM tokens_contrasena WHERE usuario_id = $1', id);
      // El correo anonimizado sigue siendo unico (lleva el id) y usa un
      // dominio reservado (.invalid, RFC 2606): nunca le llega nada.
      await m.query(
        `UPDATE usuarios
            SET nombre = $2, email = 'suprimido-' || id || '@suprimido.invalid',
                telefono = NULL, ciudad = NULL, password_hash = $3,
                activo = false, sesiones_validas_desde = now(),
                suprimido_en = now(), actualizado_en = now()
          WHERE id = $1`,
        [usuarioId, NOMBRE_SUPRIMIDO, hashNuevo],
      );
    });
    return { conservado: CONSERVADO_AL_SUPRIMIR };
  }

  // ------------------------------------------------------------ privados

  /**
   * Solo el cliente suprime su cuenta: la del personal la gestiona su
   * taller (baja de tecnico). Y no con turnos por delante: la supresion no
   * procede mientras haya una relacion vigente (articulo 9 del Decreto 1377
   * de 2013), y el taller se quedaria con un turno sin a quien avisarle.
   */
  private async puedeSuprimir(
    usuario: Pick<Usuario, 'id' | 'rol'>,
  ): Promise<{ posible: boolean; motivo: string | null }> {
    if (usuario.rol !== RolUsuario.CLIENTE) {
      return {
        posible: false,
        motivo:
          'Las cuentas del personal las da de baja el administrador del taller.',
      };
    }
    const [fila] = await this.db.query<{ total: number }[]>(
      `SELECT count(*)::int AS total FROM turnos
        WHERE usuario_id = $1 AND estado = 'programado'
          AND upper(rango_tiempo) > now()`,
      [usuario.id],
    );
    if (fila.total > 0) {
      return {
        posible: false,
        motivo: `Tenes ${fila.total} turno(s) por delante. Cancelalos primero desde "Mis turnos".`,
      };
    }
    return { posible: true, motivo: null };
  }

  private async perfil(usuarioId: string): Promise<Perfil> {
    const usuario = await this.db
      .repo(Usuario, this.usuarios)
      .findOne({ where: { id: usuarioId } });
    if (!usuario) throw new NotFoundException('Usuario no encontrado.');
    return {
      id: usuario.id,
      email: usuario.email,
      nombre: usuario.nombre,
      rol: usuario.rol,
      telefono: usuario.telefono ?? null,
      ciudad: usuario.ciudad ?? null,
      creadoEn: usuario.creadoEn,
    };
  }

  private solicitudes(usuarioId: string): Promise<Solicitud[]> {
    return this.db.query<Solicitud[]>(
      `SELECT id, tipo, detalle, creado_en AS "creadoEn"
         FROM solicitudes_titular WHERE usuario_id = $1
        ORDER BY creado_en DESC`,
      [usuarioId],
    );
  }

  private async registrarSolicitud(
    usuarioId: string,
    tipo: Solicitud['tipo'],
    detalle: Record<string, unknown>,
    origen: Origen,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO solicitudes_titular (usuario_id, tipo, detalle, ip)
       VALUES ($1, $2, $3, $4)`,
      [usuarioId, tipo, detalle, origen.ip],
    );
  }
}
