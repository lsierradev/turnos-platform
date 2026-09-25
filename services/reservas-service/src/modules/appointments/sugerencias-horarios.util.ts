import {
  diaDelTaller,
  horarioPorDefecto,
  limitesDelDia,
  proximosDiasAbiertos,
  type HorarioTaller,
} from '../../common/horario.util';
import {
  fechaEnZona,
  zonaHorariaNegocio,
} from '../../common/zona-horaria.util';
import { RangoTiempo } from '../../entities/turno.entity';

export interface SugerirHorariosParams {
  inicioSolicitado: Date;
  duracionMinutos: number;
  turnosOcupados: RangoTiempo[];
  /** Horario del taller (Sprint 21). Default: todos los dias 08:00-18:00. */
  horario?: HorarioTaller;
  /** Zona IANA del taller. Default: TZ_NEGOCIO (America/Bogota). */
  zonaHoraria?: string;
  /** Granularidad de busqueda de candidatos, en minutos. Default 15. */
  pasoMinutos?: number;
  /**
   * Cuantos dias DE ATENCION explorar desde el solicitado (inclusive).
   * Default 3. Los cerrados y festivos no cuentan (Sprint 21).
   */
  diasBusqueda?: number;
  /** Cuantas sugerencias devolver como maximo. Default 3. */
  cantidad?: number;
}

const PASO_MINUTOS_DEFAULT = 15;
// Exportado para que el llamador pueda pedirle a la DB exactamente la
// ventana que esta funcion va a explorar, en vez de traerse todos los
// turnos historicos del recurso y filtrarlos aca.
export const DIAS_BUSQUEDA_DEFAULT = 3;
const CANTIDAD_DEFAULT = 3;

function seSolapan(a: RangoTiempo, b: RangoTiempo): boolean {
  return a.inicio < b.fin && b.inicio < a.fin;
}

/**
 * Busca, dentro del horario laboral y en una ventana de dias hacia adelante,
 * los `cantidad` huecos libres mas cercanos (por diferencia absoluta de
 * tiempo) a `inicioSolicitado` que no se solapen con `turnosOcupados` y que
 * duren `duracionMinutos`. Funcion pura: no toca la base de datos, para que
 * se pueda probar exhaustivamente sin una Postgres real.
 */
export function sugerirHorarios(params: SugerirHorariosParams): RangoTiempo[] {
  const {
    inicioSolicitado,
    duracionMinutos,
    turnosOcupados,
    horario = horarioPorDefecto(),
    pasoMinutos = PASO_MINUTOS_DEFAULT,
    diasBusqueda = DIAS_BUSQUEDA_DEFAULT,
    cantidad = CANTIDAD_DEFAULT,
    zonaHoraria = zonaHorariaNegocio(),
  } = params;

  const duracionMs = duracionMinutos * 60_000;
  const pasoMs = pasoMinutos * 60_000;
  const candidatos: { rango: RangoTiempo; distanciaMs: number }[] = [];

  // Los dias se cuentan en la zona del taller: una solicitud para las 23:00
  // locales del lunes (04:00 UTC del martes) explora desde el LUNES local,
  // no desde el martes UTC.
  const fechaSolicitada = fechaEnZona(inicioSolicitado, zonaHoraria);

  for (const { fecha, jornada } of proximosDiasAbiertos(
    horario,
    fechaSolicitada,
    diasBusqueda,
  )) {
    const { apertura: aperturaDia, cierre: cierreDia } = limitesDelDia(
      fecha,
      jornada,
      zonaHoraria,
    );

    for (
      let inicioCandidato = new Date(aperturaDia);
      inicioCandidato.getTime() + duracionMs <= cierreDia.getTime();
      inicioCandidato = new Date(inicioCandidato.getTime() + pasoMs)
    ) {
      const finCandidato = new Date(inicioCandidato.getTime() + duracionMs);
      const rango: RangoTiempo = { inicio: inicioCandidato, fin: finCandidato };

      const ocupado = turnosOcupados.some((turno) => seSolapan(rango, turno));
      if (!ocupado) {
        candidatos.push({
          rango,
          distanciaMs: Math.abs(
            inicioCandidato.getTime() - inicioSolicitado.getTime(),
          ),
        });
      }
    }
  }

  return candidatos
    .sort(
      (a, b) =>
        a.distanciaMs - b.distanciaMs ||
        a.rango.inicio.getTime() - b.rango.inicio.getTime(),
    )
    .slice(0, cantidad)
    .map((c) => c.rango);
}

export interface HorariosLibresParams {
  /** Dia del taller, YYYY-MM-DD. */
  fecha: string;
  duracionMinutos: number;
  turnosOcupados: RangoTiempo[];
  /** Los horarios que ya empezaron no se ofrecen. */
  ahora: Date;
  zonaHoraria?: string;
  horario?: HorarioTaller;
  pasoMinutos?: number;
}

/**
 * Todos los horarios reservables de UN dia, en orden: la grilla que muestra
 * el formulario de reserva. Mismos criterios que sugerirHorarios y que
 * validarHorarioReservable (jornada local, paso de 15 min, sin pasado): si
 * se separaran, la pantalla ofreceria horarios que el POST despues rechaza.
 * Un dia cerrado o festivo no tiene horarios.
 */
export function horariosLibresDelDia(
  params: HorariosLibresParams,
): RangoTiempo[] {
  const {
    fecha,
    duracionMinutos,
    turnosOcupados,
    ahora,
    zonaHoraria = zonaHorariaNegocio(),
    horario = horarioPorDefecto(),
    pasoMinutos = PASO_MINUTOS_DEFAULT,
  } = params;

  const dia = diaDelTaller(horario, fecha);
  if (!dia.abierto) return [];
  const limites = limitesDelDia(fecha, dia.jornada, zonaHoraria);
  const duracionMs = duracionMinutos * 60_000;
  const pasoMs = pasoMinutos * 60_000;
  const cierre = limites.cierre.getTime();
  const libres: RangoTiempo[] = [];

  for (
    let t = limites.apertura.getTime();
    t + duracionMs <= cierre;
    t += pasoMs
  ) {
    if (t < ahora.getTime()) continue;
    const rango: RangoTiempo = {
      inicio: new Date(t),
      fin: new Date(t + duracionMs),
    };
    if (!turnosOcupados.some((turno) => seSolapan(rango, turno))) {
      libres.push(rango);
    }
  }
  return libres;
}
