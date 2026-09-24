import {
  fechaEnZona,
  instanteEnZona,
  sumarDiasFecha,
  zonaHorariaNegocio,
} from '../../common/zona-horaria.util';
import { RangoTiempo } from '../../entities/turno.entity';

export interface SugerirHorariosParams {
  inicioSolicitado: Date;
  duracionMinutos: number;
  turnosOcupados: RangoTiempo[];
  /** Hora de apertura (0-23), hora de pared de `zonaHoraria`. Default 8. */
  horaApertura?: number;
  /** Hora de cierre (0-23), hora de pared de `zonaHoraria`. Default 18. */
  horaCierre?: number;
  /** Zona IANA del taller. Default: TZ_NEGOCIO (America/Bogota). */
  zonaHoraria?: string;
  /** Granularidad de busqueda de candidatos, en minutos. Default 15. */
  pasoMinutos?: number;
  /** Cuantos dias hacia adelante (incluyendo el dia solicitado) explorar. Default 3. */
  diasBusqueda?: number;
  /** Cuantas sugerencias devolver como maximo. Default 3. */
  cantidad?: number;
}

export const HORA_APERTURA_DEFAULT = 8;
export const HORA_CIERRE_DEFAULT = 18;
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
    horaApertura = HORA_APERTURA_DEFAULT,
    horaCierre = HORA_CIERRE_DEFAULT,
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

  for (let dia = 0; dia < diasBusqueda; dia += 1) {
    const fecha = sumarDiasFecha(fechaSolicitada, dia);
    const aperturaDia = instanteEnZona(fecha, horaApertura, 0, zonaHoraria);
    const cierreDia = instanteEnZona(fecha, horaCierre, 0, zonaHoraria);

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
