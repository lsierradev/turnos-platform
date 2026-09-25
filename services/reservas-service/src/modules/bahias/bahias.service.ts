import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ContextoDb } from '@turnos-platform/tenant';
import {
  diaDelTaller,
  horarioPorDefecto,
  minutosAHora,
} from '../../common/horario.util';
import { RedisCacheService } from '../../common/redis-cache.service';
import {
  fechaEnZona,
  inicioDelDiaEnZona,
  sumarDiasFecha,
  zonaHorariaNegocio,
} from '../../common/zona-horaria.util';
import { HorarioService } from '../configuracion/horario.service';
import { BahiaDto } from './dto/bahia.dto';
import { CargaQueryDto } from './dto/carga-query.dto';
import {
  calcularOcupacion,
  esAlerta,
  nivelOcupacion,
  UMBRALES,
  type NivelOcupacion,
} from './ocupacion.util';

const MS_POR_DIA = 24 * 60 * 60 * 1000;

// Tope del rango: el panel pide 1 dia o 1 semana; 31 cubre "el mes" sin
// dejar que un ?desde=2000-01-01 genere bahias x 9000 dias de filas.
const MAX_DIAS_RANGO = 31;

// Mismo criterio que DashboardService: el panel comparte pool de
// conexiones con POST /appointments y no puede quedarse con una conexion
// tomada si la consulta se degrada.
const TIMEOUT_CONSULTA_MS = 5_000;

// TTL del cache, en segundos. Mismo patron que el dashboard (clave por
// zona + rango, un fallo de Redis nunca rompe la lectura), con un TTL mas
// largo porque el panel es de planificacion, no de monitoreo en vivo: el
// front refresca cada 15 s (admin-web, features/admin-panel/
// useCargaQuery.ts) y el peor desfase queda en TTL + intervalo = 20 s. Si
// se toca uno, revisar el otro.
const TTL_CACHE_SEGUNDOS = 5;

// Una pasada sobre turnos, agregando por bahia y por dia DEL TALLER.
//
// - Parte de bahias x dias (CROSS JOIN) para que una bahia sin turnos
//   aparezca con 0 en vez de desaparecer: "libre todo el dia" es un dato.
// - Cada turno suma solo lo que cae DENTRO de la jornada de su dia local:
//   [dia + apertura, dia + cierre) en TZ_NEGOCIO. `fecha + time` es un
//   timestamp sin zona; AT TIME ZONE $2 lo vuelve el instante real.
// - La jornada es la del taller cada dia (Sprint 21): llega en $1 como
//   JSON, un registro por dia del rango. Un dia cerrado viene 00:00-00:00:
//   ahi nada suma minutos.
// - El WHERE va sobre lower(rango_tiempo) crudo (sargable contra
//   idx_turnos_kpi_inicio, 009), como el dashboard; la conversion de zona
//   queda en el GROUP BY.
// - Los cancelados no ocupan, igual que en las constraints EXCLUDE desde
//   la migracion 011 (su horario se puede volver a reservar).
const SQL_CARGA = `
  WITH dias AS (
    SELECT j.dia, j.apertura, j.cierre
    FROM jsonb_to_recordset($1::jsonb) AS j(dia date, apertura time, cierre time)
  ),
  ocupacion AS (
    SELECT
      t.bahia_id,
      d.dia,
      count(*)::int AS turnos,
      coalesce(sum(greatest(0, extract(epoch FROM
        least(upper(t.rango_tiempo), (d.dia + d.cierre) AT TIME ZONE $2)
        - greatest(lower(t.rango_tiempo), (d.dia + d.apertura) AT TIME ZONE $2)
      ))), 0) / 60 AS minutos
    FROM turnos t
    JOIN dias d ON d.dia = (lower(t.rango_tiempo) AT TIME ZONE $2)::date
    WHERE lower(t.rango_tiempo) >= $3
      AND lower(t.rango_tiempo) <  $4
      AND t.estado <> 'cancelado'
      AND ($5::uuid IS NULL OR t.taller_id = $5)
    GROUP BY 1, 2
  )
  SELECT
    b.id                                  AS "bahiaId",
    b.nombre                              AS nombre,
    to_char(d.dia, 'YYYY-MM-DD')          AS fecha,
    coalesce(o.turnos, 0)::int            AS turnos,
    coalesce(o.minutos, 0)::float8        AS "minutosOcupados"
  FROM bahias b
  CROSS JOIN dias d
  LEFT JOIN ocupacion o ON o.bahia_id = b.id AND o.dia = d.dia
  WHERE b.activa
    AND ($5::uuid IS NULL OR b.taller_id = $5)
  ORDER BY b.nombre, b.id, d.dia
`;

// Detalle de una bahia en un dia. Tecnico y cliente salen de `usuarios`,
// tabla de usuarios-service (misma Postgres; ver tecnicos.util.ts). Incluye
// los cancelados: el admin quiere verlos, marcados.
const SQL_TURNOS_BAHIA = `
  SELECT
    t.id,
    lower(t.rango_tiempo) AS inicio,
    upper(t.rango_tiempo) AS fin,
    t.estado,
    s.nombre     AS "servicioNombre",
    s.categoria  AS "servicioCategoria",
    tec.id       AS "tecnicoId",
    tec.nombre   AS "tecnicoNombre",
    cli.nombre   AS "clienteNombre"
  FROM turnos t
  JOIN servicios s ON s.id = t.servicio_id
  LEFT JOIN usuarios tec ON tec.id = t.tecnico_id
  LEFT JOIN usuarios cli ON cli.id = t.usuario_id
  WHERE t.bahia_id = $1
    AND lower(t.rango_tiempo) >= $2
    AND lower(t.rango_tiempo) <  $3
  ORDER BY lower(t.rango_tiempo)
`;

interface FilaCarga {
  bahiaId: string;
  nombre: string;
  fecha: string;
  turnos: number;
  minutosOcupados: number;
}

export interface CargaDia {
  fecha: string;
  turnos: number;
  minutosOcupados: number;
  /** 0..1 sobre la jornada laboral. */
  ocupacion: number;
  nivel: NivelOcupacion;
}

export interface CargaBahia {
  bahiaId: string;
  nombre: string;
  dias: CargaDia[];
}

/** Horario del taller ese dia; null si no atiende (ver cerrado). */
export interface JornadaDia {
  apertura: string;
  cierre: string;
  minutos: number;
}

export interface ResumenDia {
  fecha: string;
  jornada: JornadaDia | null;
  /** Motivo si no atiende ("Cerrado" o el festivo). */
  cerrado: string | null;
  turnos: number;
  minutosOcupados: number;
  /** Sobre la capacidad de TODAS las bahias activas. */
  ocupacion: number;
  bahiasEnAlerta: number;
}

export interface CargaResponse {
  desde: string;
  hasta: string;
  zonaHoraria: string;
  /**
   * La franja mas amplia del rango (apertura mas temprana, cierre mas
   * tarde): el eje de la linea de tiempo. La de cada dia va en resumen.
   */
  jornada: JornadaDia;
  umbrales: typeof UMBRALES;
  bahias: CargaBahia[];
  resumen: ResumenDia[];
}

export interface TurnoDeBahia {
  id: string;
  inicio: string;
  fin: string;
  estado: 'programado' | 'atendido' | 'no_asistio' | 'cancelado';
  servicio: {
    nombre: string;
    categoria: 'mecanica' | 'electrica' | 'latoneria';
  };
  tecnico: { id: string; nombre: string } | null;
  clienteNombre: string | null;
}

export interface TurnosBahiaResponse {
  bahia: { id: string; nombre: string; activa: boolean };
  fecha: string;
  turnos: TurnoDeBahia[];
}

/** Eje comun del rango; si no atiende ningun dia, el horario historico. */
function franjaMasAmplia(jornadas: (JornadaDia | null)[]): JornadaDia {
  const abiertas = jornadas.filter((j): j is JornadaDia => j !== null);
  if (abiertas.length === 0) {
    return { apertura: '08:00', cierre: '18:00', minutos: 600 };
  }
  const apertura = abiertas.map((j) => j.apertura).sort()[0];
  const cierre = abiertas
    .map((j) => j.cierre)
    .sort()
    .at(-1)!;
  const aMin = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3));
  return { apertura, cierre, minutos: aMin(cierre) - aMin(apertura) };
}

@Injectable()
export class BahiasService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly cache: RedisCacheService,
    private readonly db: ContextoDb,
    private readonly horarios: HorarioService,
  ) {}

  /**
   * Bahias en servicio del taller de la sesion, para elegir una al
   * reservar. Filtro explicito: RLS tambien le muestra al cliente las
   * bahias de sus turnos en otros talleres.
   */
  listarActivas(): Promise<{ id: string; nombre: string }[]> {
    return this.db.query(
      `SELECT id, nombre FROM bahias
        WHERE activa AND ($1::uuid IS NULL OR taller_id = $1)
        ORDER BY nombre, id`,
      [this.db.tallerActual()],
      this.dataSource,
    );
  }

  /** Todas, en servicio o no: el catalogo del admin (Sprint 21). */
  listarTodas(): Promise<{ id: string; nombre: string; activa: boolean }[]> {
    return this.db.query(
      `SELECT id, nombre, activa FROM bahias
        WHERE taller_id = $1
        ORDER BY nombre, id`,
      [this.db.exigirTaller()],
      this.dataSource,
    );
  }

  async crear(
    dto: BahiaDto,
  ): Promise<{ id: string; nombre: string; activa: boolean }> {
    const [bahia] = (await this.db.query(
      `INSERT INTO bahias (nombre, activa, taller_id) VALUES ($1, $2, $3)
       RETURNING id, nombre, activa`,
      [dto.nombre.trim(), dto.activa ?? true, this.db.exigirTaller()],
      this.dataSource,
    )) as { id: string; nombre: string; activa: boolean }[];
    return bahia;
  }

  /**
   * Renombrar o sacar de servicio. Una bahia no se borra: sus turnos
   * pasados la nombran. Sacarla de servicio no toca los turnos que ya
   * tiene; se avisa cuantos quedan por venir.
   */
  async actualizar(
    id: string,
    dto: Partial<BahiaDto>,
  ): Promise<{
    id: string;
    nombre: string;
    activa: boolean;
    turnosPorVenir: number;
  }> {
    const taller = this.db.exigirTaller();
    // Envuelto en un SELECT: un UPDATE crudo via TypeORM devuelve
    // [filas, cantidad] en vez de las filas.
    const [bahia] = (await this.db.query(
      `WITH cambiada AS (
         UPDATE bahias
            SET nombre = coalesce($3, nombre),
                activa = coalesce($4, activa),
                actualizado_en = now()
          WHERE id = $1 AND taller_id = $2
        RETURNING id, nombre, activa
       )
       SELECT * FROM cambiada`,
      [id, taller, dto.nombre?.trim() ?? null, dto.activa ?? null],
      this.dataSource,
    )) as { id: string; nombre: string; activa: boolean }[];
    if (!bahia) {
      throw new NotFoundException(`Bahia ${id} no encontrada`);
    }
    const [{ total }] = (await this.db.query(
      `SELECT count(*)::int AS total FROM turnos
        WHERE bahia_id = $1 AND estado = 'programado' AND lower(rango_tiempo) > now()`,
      [id],
      this.dataSource,
    )) as { total: number }[];
    return { ...bahia, turnosPorVenir: total };
  }

  async carga(query: CargaQueryDto): Promise<CargaResponse> {
    const zona = zonaHorariaNegocio();
    const { desde, hasta } = this.rango(query, zona);

    // Misma forma de clave que el dashboard: la zona entra porque el mismo
    // rango cubre instantes distintos segun TZ_NEGOCIO.
    // El taller va en la clave (Sprint 20): sin el, un taller veria la carga
    // que dejo en cache otro.
    const tallerId = this.db.tallerActual();
    const claveCache = `carga-bahias:${tallerId ?? 'sistema'}:${zona}:${desde}:${hasta}`;
    const cacheado = await this.cache.obtener<CargaResponse>(claveCache);
    if (cacheado) {
      return cacheado;
    }

    // Jornada de cada dia del rango segun el horario y los festivos del
    // taller (Sprint 21). Sin taller, el horario historico.
    const horario = tallerId
      ? await this.horarios.obtener(desde, hasta, tallerId)
      : horarioPorDefecto();
    const jornadas = new Map<
      string,
      { jornada: JornadaDia | null; cerrado: string | null }
    >();
    for (let fecha = desde; fecha <= hasta; fecha = sumarDiasFecha(fecha, 1)) {
      const dia = diaDelTaller(horario, fecha);
      jornadas.set(
        fecha,
        dia.abierto
          ? {
              jornada: {
                apertura: minutosAHora(dia.jornada.apertura),
                cierre: minutosAHora(dia.jornada.cierre),
                minutos: dia.jornada.cierre - dia.jornada.apertura,
              },
              cerrado: null,
            }
          : { jornada: null, cerrado: dia.motivo },
      );
    }
    const jornadasSql = [...jornadas].map(([dia, j]) => ({
      dia,
      apertura: j.jornada?.apertura ?? '00:00',
      cierre: j.jornada?.cierre ?? '00:00',
    }));

    const filas = await this.db.transaccion(async (manager) => {
      await manager.query(
        `SET LOCAL statement_timeout = ${TIMEOUT_CONSULTA_MS}`,
      );
      return (await manager.query(SQL_CARGA, [
        JSON.stringify(jornadasSql),
        zona,
        inicioDelDiaEnZona(desde, zona),
        inicioDelDiaEnZona(sumarDiasFecha(hasta, 1), zona),
        tallerId,
      ])) as FilaCarga[];
    }, this.dataSource);

    const bahias = new Map<string, CargaBahia>();
    for (const fila of filas) {
      let bahia = bahias.get(fila.bahiaId);
      if (!bahia) {
        bahia = { bahiaId: fila.bahiaId, nombre: fila.nombre, dias: [] };
        bahias.set(fila.bahiaId, bahia);
      }
      const minutos = Math.round(Number(fila.minutosOcupados));
      const ocupacion = calcularOcupacion(
        minutos,
        jornadas.get(fila.fecha)?.jornada?.minutos ?? 0,
      );
      bahia.dias.push({
        fecha: fila.fecha,
        turnos: fila.turnos,
        minutosOcupados: minutos,
        ocupacion,
        nivel: nivelOcupacion(ocupacion, fila.turnos),
      });
    }

    const lista = [...bahias.values()];
    const resumen: ResumenDia[] = [];
    for (let fecha = desde; fecha <= hasta; fecha = sumarDiasFecha(fecha, 1)) {
      const delDia = lista.map((b) => b.dias.find((d) => d.fecha === fecha)!);
      const minutos = delDia.reduce((t, d) => t + d.minutosOcupados, 0);
      const { jornada, cerrado } = jornadas.get(fecha)!;
      const capacidad = (jornada?.minutos ?? 0) * lista.length;
      resumen.push({
        fecha,
        jornada,
        cerrado,
        turnos: delDia.reduce((t, d) => t + d.turnos, 0),
        minutosOcupados: minutos,
        ocupacion:
          capacidad === 0 ? 0 : Math.round((minutos / capacidad) * 1000) / 1000,
        bahiasEnAlerta: delDia.filter((d) => esAlerta(d.nivel)).length,
      });
    }

    const respuesta: CargaResponse = {
      desde,
      hasta,
      zonaHoraria: zona,
      jornada: franjaMasAmplia([...jornadas.values()].map((j) => j.jornada)),
      umbrales: UMBRALES,
      bahias: lista,
      resumen,
    };
    await this.cache.guardar(claveCache, respuesta, TTL_CACHE_SEGUNDOS);
    return respuesta;
  }

  async turnosDeBahia(
    bahiaId: string,
    fechaQuery: string | undefined,
  ): Promise<TurnosBahiaResponse> {
    const zona = zonaHorariaNegocio();
    const fecha = fechaQuery ?? fechaEnZona(new Date(), zona);
    this.validarFecha(fecha, 'fecha');

    const [bahia] = (await this.db.query(
      `SELECT id, nombre, activa FROM bahias
        WHERE id = $1 AND ($2::uuid IS NULL OR taller_id = $2)`,
      [bahiaId, this.db.tallerActual()],
      this.dataSource,
    )) as TurnosBahiaResponse['bahia'][];
    if (!bahia) {
      throw new NotFoundException(`Bahia ${bahiaId} no encontrada`);
    }

    const filas = (await this.db.query(
      SQL_TURNOS_BAHIA,
      [
        bahiaId,
        inicioDelDiaEnZona(fecha, zona),
        inicioDelDiaEnZona(sumarDiasFecha(fecha, 1), zona),
      ],
      this.dataSource,
    )) as Array<{
      id: string;
      inicio: Date;
      fin: Date;
      estado: TurnoDeBahia['estado'];
      servicioNombre: string;
      servicioCategoria: TurnoDeBahia['servicio']['categoria'];
      tecnicoId: string | null;
      tecnicoNombre: string | null;
      clienteNombre: string | null;
    }>;

    return {
      bahia,
      fecha,
      turnos: filas.map((f) => ({
        id: f.id,
        inicio: new Date(f.inicio).toISOString(),
        fin: new Date(f.fin).toISOString(),
        estado: f.estado,
        servicio: { nombre: f.servicioNombre, categoria: f.servicioCategoria },
        tecnico: f.tecnicoId
          ? { id: f.tecnicoId, nombre: f.tecnicoNombre ?? '' }
          : null,
        clienteNombre: f.clienteNombre,
      })),
    };
  }

  private rango(
    query: CargaQueryDto,
    zona: string,
  ): { desde: string; hasta: string } {
    const hoy = fechaEnZona(new Date(), zona);
    const desde = query.desde ?? query.hasta ?? hoy;
    const hasta = query.hasta ?? query.desde ?? hoy;
    const inicio = this.validarFecha(desde, 'desde');
    const fin = this.validarFecha(hasta, 'hasta');

    if (fin < inicio) {
      throw new BadRequestException('`desde` no puede ser posterior a `hasta`');
    }
    const dias = (fin.getTime() - inicio.getTime()) / MS_POR_DIA + 1;
    if (dias > MAX_DIAS_RANGO) {
      throw new BadRequestException(
        `El rango no puede superar ${MAX_DIAS_RANGO} dias (se pidieron ${dias})`,
      );
    }
    return { desde, hasta };
  }

  /**
   * El DTO valida la FORMA (YYYY-MM-DD); esto valida que el dia exista.
   * Medianoche UTC solo como calculadora de calendario.
   */
  private validarFecha(fecha: string, campo: string): Date {
    const d = new Date(`${fecha}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== fecha) {
      throw new BadRequestException(`${campo} no es una fecha valida`);
    }
    return d;
  }
}
