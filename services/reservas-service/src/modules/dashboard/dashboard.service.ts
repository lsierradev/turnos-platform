import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RedisCacheService } from '../../common/redis-cache.service';
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
// - AT TIME ZONE 'UTC' va en el GROUP BY y NO en el WHERE, a proposito:
//   date_trunc('day', timestamptz) usa el TimeZone de la sesion, que
//   depende de como este configurado el servidor -- los dias saldrian
//   corridos segun donde corra Postgres. El WHERE se deja sobre la columna
//   cruda para que siga siendo sargable contra el indice; envolver
//   lower(rango_tiempo) en una conversion ahi lo volveria inutilizable.
//
// - Devuelve SUMAS y CONTEOS, no promedios por dia. El resumen del periodo
//   se calcula despues en Node dividiendo los totales. Promediar los
//   promedios diarios daria un numero distinto (y mal): un dia con 1 turno
//   pesaria igual que uno con 40.
const SQL_KPIS = `
  SELECT
    date_trunc('day', lower(rango_tiempo) AT TIME ZONE 'UTC') AS dia,
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
  GROUP BY 1
  ORDER BY 1
`;

interface FilaKpis {
  dia: Date;
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
  resumen: KpisResumen;
  serie: KpiDia[];
}

function fechaISO(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
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
  ) {}

  async kpis(query: KpisQueryDto): Promise<KpisResponse> {
    const { from, to, desde, hasta } = this.rangoUtc(query);

    // La clave incluye el rango: dos admins mirando periodos distintos no
    // deben compartir entrada. Con el rango por defecto (hoy) todos los
    // paneles abiertos caen en la misma clave, que es justamente el caso que
    // hace falta abaratar.
    const claveCache = `kpis:${from}:${to}`;
    const cacheado = await this.cache.obtener<KpisResponse>(claveCache);
    if (cacheado) {
      return cacheado;
    }

    const filas = await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `SET LOCAL statement_timeout = ${TIMEOUT_CONSULTA_MS}`,
      );
      return (await manager.query(SQL_KPIS, [desde, hasta])) as FilaKpis[];
    });

    const porDia = new Map<string, FilaKpis>();
    for (const fila of filas) {
      porDia.set(fechaISO(new Date(fila.dia)), fila);
    }

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
    for (
      let dia = new Date(desde);
      dia < hasta;
      dia = new Date(dia.getTime() + MS_POR_DIA)
    ) {
      const fecha = fechaISO(dia);
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

    const respuesta: KpisResponse = { rango: { from, to }, resumen, serie };
    await this.cache.guardar(claveCache, respuesta, TTL_CACHE_SEGUNDOS);
    return respuesta;
  }

  // Traduce ?from=&to= (dias inclusive, en UTC) a la ventana half-open
  // [desde, hasta) que usa la consulta. Misma convencion UTC explicita que
  // technicians.service.ts: el backend nunca usa la hora local del proceso
  // para delimitar un dia.
  private rangoUtc(query: KpisQueryDto): {
    from: string;
    to: string;
    desde: Date;
    hasta: Date;
  } {
    const hoy = fechaISO(new Date());
    const from = query.from ?? query.to ?? hoy;
    const to = query.to ?? query.from ?? hoy;

    const desde = new Date(`${from}T00:00:00.000Z`);
    const finInclusivo = new Date(`${to}T00:00:00.000Z`);

    // El regex del DTO acepta cosas como 2024-13-45: valida la FORMA, no
    // que la fecha exista. Date() la convierte en NaN y, sin este chequeo,
    // el rango llegaria a Postgres como null y el dashboard devolveria
    // ceros en vez de un error.
    if (Number.isNaN(desde.getTime()) || Number.isNaN(finInclusivo.getTime())) {
      throw new BadRequestException('from/to no son fechas validas');
    }

    if (finInclusivo < desde) {
      throw new BadRequestException('`from` no puede ser posterior a `to`');
    }

    const dias = (finInclusivo.getTime() - desde.getTime()) / MS_POR_DIA + 1;
    if (dias > MAX_DIAS_RANGO) {
      throw new BadRequestException(
        `El rango no puede superar ${MAX_DIAS_RANGO} dias (se pidieron ${dias})`,
      );
    }

    return {
      from,
      to,
      desde,
      hasta: new Date(finInclusivo.getTime() + MS_POR_DIA),
    };
  }
}
