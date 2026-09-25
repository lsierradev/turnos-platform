import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ContextoDb } from '@turnos-platform/tenant';
import { RedisCacheService } from '../../common/redis-cache.service';
import {
  fechaEnZona,
  inicioDelDiaEnZona,
  sumarDiasFecha,
  zonaHorariaNegocio,
} from '../../common/zona-horaria.util';
import { KpisQueryDto } from './dto/kpis-query.dto';

const MS_POR_DIA = 24 * 60 * 60 * 1000;

// Tope duro del rango consultable. No es una regla de negocio: es el limite
// que mantiene acotado el trabajo que el dashboard le pide a la DB. Sin el,
// un ?from=2000-01-01 recorre la tabla entera de turnos -- exactamente el
// seq scan que el indice de 009 existe para evitar. 92 dias cubre el caso
// real (un trimestre) y deja el peor caso de la consulta en un numero de
// filas predecible.
const MAX_DIAS_RANGO = 92;

// La consulta de KPIs corre con su propio statement_timeout, mas bajo que el
// del resto del servicio. El motor de reservas (POST /appointments) y el
// dashboard comparten pool de conexiones: si una consulta de dashboard se
// degrada (estadisticas viejas, un plan que se cae a seq scan), sin timeout
// se queda ocupando una conexion del pool por minutos y las reservas empiezan
// a esperar por una conexion libre. Con el timeout el dashboard falla rapido,
// que es el modo de falla correcto: es una vista de lectura, no el camino
// critico del negocio.
const TIMEOUT_CONSULTA_MS = 5_000;

// TTL del cache de KPIs, en segundos.
//
// Sale de la aritmetica del criterio "desfase del panel admin < 5 s"
// (SRS 14). El desfase que ve el usuario es, en el peor caso,
// TTL + intervalo de polling: un dato puede cambiar justo despues de que se
// llenara el cache (hasta TTL segundos de espera) y ademas el panel puede
// acabar de pedir (hasta un intervalo mas). Con TTL 2 s y polling de 2 s el
// peor caso es 4 s, con un segundo de margen.
//
// Si se toca uno de los dos numeros hay que tocar el otro: el del frontend
// esta en apps/admin-web/src/features/dashboard/useKpisQuery.ts.
const TTL_CACHE_SEGUNDOS = 2;

// Una sola pasada sobre `turnos`, agrupando por dia. Decisiones:
//
// - Filtra por lower(rango_tiempo), que es exactamente la clave de
//   idx_turnos_kpi_inicio (009). Las tres columnas del INCLUDE son las
//   unicas que lee la agregacion, asi que el plan puede resolverse sin
//   tocar el heap de turnos.
//
// - AT TIME ZONE $3 (la zona de negocio, TZ_NEGOCIO) va en el GROUP BY y NO
//   en el WHERE, a proposito: agrupar un timestamptz sin zona explicita usa
//   el TimeZone de la sesion, que depende de como este configurado el
//   servidor. Con 'UTC' fijo (hasta Sprint 11) un turno de las 20:00 en
//   Bogota contaba para el dia siguiente. El WHERE se deja sobre la columna
//   cruda para que siga siendo sargable contra el indice; envolver
//   lower(rango_tiempo) en una conversion ahi lo volveria inutilizable.
//
// - El dia sale como TEXTO (to_char), no como timestamp: AT TIME ZONE
//   devuelve un timestamp SIN zona, y el driver pg lo parsearia como hora
//   local del proceso Node -- volviendo a depender de la zona del proceso.
//
// - Devuelve SUMAS y CONTEOS, no promedios por dia. El resumen del periodo
//   se calcula despues en Node dividiendo los totales. Promediar los
//   promedios diarios daria un numero distinto (y mal): un dia con 1 turno
//   pesaria igual que uno con 40.
const SQL_KPIS = `
  SELECT
    to_char(lower(rango_tiempo) AT TIME ZONE $3, 'YYYY-MM-DD') AS dia,
    count(*) FILTER (WHERE estado = 'atendido')::int          AS atendidos,
    count(*) FILTER (WHERE estado = 'no_asistio')::int        AS no_asistio,
    count(*) FILTER (WHERE estado = 'cancelado')::int         AS cancelados,
    count(*) FILTER (WHERE estado = 'programado')::int        AS programados,
    count(*) FILTER (
      WHERE estado = 'atendido'
        AND atencion_inicio IS NOT NULL
        AND atencion_fin IS NOT NULL
    )::int AS medidos,
    coalesce(
      sum(extract(epoch FROM (atencion_fin - atencion_inicio))) FILTER (
        WHERE estado = 'atendido'
          AND atencion_inicio IS NOT NULL
          AND atencion_fin IS NOT NULL
      ),
      0
    ) AS segundos_servicio
  FROM turnos
  WHERE lower(rango_tiempo) >= $1
    AND lower(rango_tiempo) <  $2
    AND ($4::uuid IS NULL OR tecnico_id = $4)
    AND ($5::uuid IS NULL OR taller_id = $5)
  GROUP BY 1
  ORDER BY 1
`;

interface FilaKpis {
  /** YYYY-MM-DD en la zona de negocio. */
  dia: string;
  atendidos: number;
  no_asistio: number;
  cancelados: number;
  programados: number;
  medidos: number;
  segundos_servicio: string;
}

export interface KpiDia {
  fecha: string;
  atendidos: number;
  noAsistio: number;
  cancelados: number;
  programados: number;
  turnosMedidos: number;
  tasaAsistencia: number | null;
  minutosPromedioServicio: number | null;
}

export interface KpisResumen {
  turnosTotales: number;
  turnosAtendidos: number;
  turnosNoAsistio: number;
  turnosCancelados: number;
  turnosProgramados: number;
  turnosMedidos: number;
  tasaAsistencia: number | null;
  minutosPromedioServicio: number | null;
}

export interface KpisResponse {
  rango: { from: string; to: string };
  zonaHoraria: string;
  /** null = el taller entero. */
  tecnicoId: string | null;
  resumen: KpisResumen;
  serie: KpiDia[];
  /**
   * El periodo inmediatamente anterior, de la misma cantidad de dias
   * (Sprint 18): contra que se compara cada KPI. Para "hoy" es ayer; para
   * los ultimos 7 dias, los 7 de antes.
   */
  anterior: { rango: { from: string; to: string }; resumen: KpisResumen };
}

// Tasa de asistencia = atendidos / (atendidos + no_asistio).
//
// Los cancelados quedan FUERA del denominador a proposito: una cancelacion
// avisada no es una inasistencia, y contarla como tal castiga al taller por
// algo que el cliente hizo bien (avisar). Los 'programado' tampoco entran:
// son turnos que todavia no se cerraron -- incluirlos haria que el KPI del
// dia de hoy arranque en 0% a la manana y suba solo con el correr del dia.
// Ambos conteos igual se devuelven aparte, para que el dashboard los pueda
// mostrar sin que contaminen el KPI.
function calcularTasaAsistencia(
  atendidos: number,
  noAsistio: number,
): number | null {
  const cerrados = atendidos + noAsistio;
  return cerrados === 0 ? null : atendidos / cerrados;
}

function promedioMinutos(
  segundos: number,
  cantidadMedidos: number,
): number | null {
  if (cantidadMedidos === 0) {
    return null;
  }
  return Math.round((segundos / cantidadMedidos / 60) * 10) / 10;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly cache: RedisCacheService,
    private readonly db: ContextoDb,
  ) {}

  /**
   * @param query.tecnicoId solo los turnos de ese tecnico (el controller lo
   *   fuerza al propio para el rol tecnico). Sin el, el taller entero.
   */
  async kpis(query: KpisQueryDto): Promise<KpisResponse> {
    const zona = zonaHorariaNegocio();
    const { from, to, fromAnterior, toAnterior, desdeAnterior, hasta } =
      this.rango(query, zona);
    const tecnicoId = query.tecnicoId ?? null;

    // La clave incluye el rango: dos admins mirando periodos distintos no
    // deben compartir entrada. Con el rango por defecto (hoy) todos los
    // paneles abiertos caen en la misma clave, que es justamente el caso que
    // hace falta abaratar. La zona tambien va en la clave: el mismo from/to
    // cubre instantes distintos segun TZ_NEGOCIO, y durante un cambio de
    // configuracion conviven instancias con valores distintos sobre el
    // mismo Redis. Y el tecnico: sin el, un tecnico veria los numeros del
    // taller entero que dejo cacheados un admin (o al reves).
    // El taller va primero en la clave (Sprint 20): sin el, dos talleres
    // compartirian los KPIs cacheados del mismo rango.
    const tallerId = this.db.tallerActual();
    const claveCache = `kpis:${tallerId ?? 'sistema'}:${zona}:${from}:${to}:${tecnicoId ?? 'todos'}`;
    const cacheado = await this.cache.obtener<KpisResponse>(claveCache);
    if (cacheado) {
      return cacheado;
    }

    // UNA consulta para los dos periodos: la ventana arranca en el inicio
    // del periodo anterior y el reparto se hace en Node por fecha. Mismo
    // costo de ida y vuelta que antes, con el doble de dias escaneados por
    // el mismo indice.
    const filas = await this.db.transaccion(async (manager) => {
      await manager.query(
        `SET LOCAL statement_timeout = ${TIMEOUT_CONSULTA_MS}`,
      );
      return (await manager.query(SQL_KPIS, [
        desdeAnterior,
        hasta,
        zona,
        tecnicoId,
        tallerId,
      ])) as FilaKpis[];
    }, this.dataSource);

    const porDia = new Map<string, FilaKpis>();
    for (const fila of filas) {
      porDia.set(fila.dia, fila);
    }

    const actual = acumular(porDia, from, to);
    const previo = acumular(porDia, fromAnterior, toAnterior);

    const respuesta: KpisResponse = {
      rango: { from, to },
      zonaHoraria: zona,
      tecnicoId,
      resumen: actual.resumen,
      serie: actual.serie,
      anterior: {
        rango: { from: fromAnterior, to: toAnterior },
        resumen: previo.resumen,
      },
    };
    await this.cache.guardar(claveCache, respuesta, TTL_CACHE_SEGUNDOS);
    return respuesta;
  }

  // Traduce ?from=&to= (dias inclusive, dias del TALLER) a la ventana
  // half-open [desde, hasta) que usa la consulta: desde = 00:00 local de
  // `from`, hasta = 00:00 local del dia siguiente a `to`. Mismo criterio que
  // technicians.service.ts; nunca la hora local del proceso. Ademas calcula
  // el periodo anterior de la misma longitud (termina el dia antes de from).
  private rango(
    query: KpisQueryDto,
    zona: string,
  ): {
    from: string;
    to: string;
    fromAnterior: string;
    toAnterior: string;
    desdeAnterior: Date;
    hasta: Date;
  } {
    const hoy = fechaEnZona(new Date(), zona);
    const from = query.from ?? query.to ?? hoy;
    const to = query.to ?? query.from ?? hoy;

    // Medianoche UTC solo como calculadora de calendario: sirve para validar
    // y contar dias, NO para delimitar la ventana de la consulta.
    const inicioCalendario = new Date(`${from}T00:00:00.000Z`);
    const finCalendario = new Date(`${to}T00:00:00.000Z`);

    // El regex del DTO acepta cosas como 2024-13-45: valida la FORMA, no
    // que la fecha exista. Date() la convierte en NaN y, sin este chequeo,
    // el rango llegaria a Postgres como null y el dashboard devolveria
    // ceros en vez de un error.
    if (
      Number.isNaN(inicioCalendario.getTime()) ||
      Number.isNaN(finCalendario.getTime())
    ) {
      throw new BadRequestException('from/to no son fechas validas');
    }

    if (finCalendario < inicioCalendario) {
      throw new BadRequestException('`from` no puede ser posterior a `to`');
    }

    const dias =
      (finCalendario.getTime() - inicioCalendario.getTime()) / MS_POR_DIA + 1;
    if (dias > MAX_DIAS_RANGO) {
      throw new BadRequestException(
        `El rango no puede superar ${MAX_DIAS_RANGO} dias (se pidieron ${dias})`,
      );
    }

    const fromAnterior = sumarDiasFecha(from, -dias);
    return {
      from,
      to,
      fromAnterior,
      toAnterior: sumarDiasFecha(from, -1),
      desdeAnterior: inicioDelDiaEnZona(fromAnterior, zona),
      hasta: inicioDelDiaEnZona(sumarDiasFecha(to, 1), zona),
    };
  }
}

/** Serie diaria y resumen de [from, to] a partir de las filas por dia. */
function acumular(
  porDia: Map<string, FilaKpis>,
  from: string,
  to: string,
): { serie: KpiDia[]; resumen: KpisResumen } {
  const serie: KpiDia[] = [];
  const resumen: KpisResumen = {
    turnosTotales: 0,
    turnosAtendidos: 0,
    turnosNoAsistio: 0,
    turnosCancelados: 0,
    turnosProgramados: 0,
    turnosMedidos: 0,
    tasaAsistencia: null,
    minutosPromedioServicio: null,
  };
  let segundosTotales = 0;

  // Se itera el rango completo, no las filas devueltas: los dias sin
  // ningun turno tienen que aparecer en la serie como ceros. Si se
  // omitieran, el grafico uniria con una linea recta el dia anterior con
  // el siguiente y un feriado sin actividad se leeria como actividad
  // normal interpolada.
  //
  // Se itera por fechas de calendario y no sumando 24 h a un instante: en
  // una zona con horario de verano hay dias de 23 y de 25 horas.
  for (let fecha = from; fecha <= to; fecha = sumarDiasFecha(fecha, 1)) {
    const fila = porDia.get(fecha);

    const atendidos = fila?.atendidos ?? 0;
    const noAsistio = fila?.no_asistio ?? 0;
    const cancelados = fila?.cancelados ?? 0;
    const programados = fila?.programados ?? 0;
    const medidos = fila?.medidos ?? 0;
    // sum() sobre un double vuelve como string desde el driver pg (que
    // prefiere preservar la precision antes que degradarla a Number).
    const segundos = Number(fila?.segundos_servicio ?? 0);

    serie.push({
      fecha,
      atendidos,
      noAsistio,
      cancelados,
      programados,
      turnosMedidos: medidos,
      tasaAsistencia: calcularTasaAsistencia(atendidos, noAsistio),
      minutosPromedioServicio: promedioMinutos(segundos, medidos),
    });

    resumen.turnosAtendidos += atendidos;
    resumen.turnosNoAsistio += noAsistio;
    resumen.turnosCancelados += cancelados;
    resumen.turnosProgramados += programados;
    resumen.turnosMedidos += medidos;
    segundosTotales += segundos;
  }

  resumen.turnosTotales =
    resumen.turnosAtendidos +
    resumen.turnosNoAsistio +
    resumen.turnosCancelados +
    resumen.turnosProgramados;
  resumen.tasaAsistencia = calcularTasaAsistencia(
    resumen.turnosAtendidos,
    resumen.turnosNoAsistio,
  );
  resumen.minutosPromedioServicio = promedioMinutos(
    segundosTotales,
    resumen.turnosMedidos,
  );

  return { serie, resumen };
}
