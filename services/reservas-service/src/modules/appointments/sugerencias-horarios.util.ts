import { RangoTiempo } from '../../entities/turno.entity';

export interface SugerirHorariosParams {
  inicioSolicitado: Date;
  duracionMinutos: number;
  turnosOcupados: RangoTiempo[];
  /** Hora de apertura (0-23), horario local, sin timezone. Default 8. */
  horaApertura?: number;
  /** Hora de cierre (0-23), horario local, sin timezone. Default 18. */
  horaCierre?: number;
  /** Granularidad de busqueda de candidatos, en minutos. Default 15. */
  pasoMinutos?: number;
  /** Cuantos dias hacia adelante (incluyendo el dia solicitado) explorar. Default 3. */
  diasBusqueda?: number;
  /** Cuantas sugerencias devolver como maximo. Default 3. */
  cantidad?: number;
}

const HORA_APERTURA_DEFAULT = 8;
const HORA_CIERRE_DEFAULT = 18;
const PASO_MINUTOS_DEFAULT = 15;
const DIAS_BUSQUEDA_DEFAULT = 3;
const CANTIDAD_DEFAULT = 3;

function seSolapan(a: RangoTiempo, b: RangoTiempo): boolean {
  return a.inicio < b.fin && b.inicio < a.fin;
}

function inicioDelDia(fecha: Date): Date {
  const dia = new Date(fecha);
  dia.setHours(0, 0, 0, 0);
  return dia;
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
  } = params;

  const duracionMs = duracionMinutos * 60_000;
  const pasoMs = pasoMinutos * 60_000;
  const candidatos: { rango: RangoTiempo; distanciaMs: number }[] = [];

  for (let dia = 0; dia < diasBusqueda; dia += 1) {
    const diaBase = inicioDelDia(inicioSolicitado);
    diaBase.setDate(diaBase.getDate() + dia);

    const aperturaDia = new Date(diaBase);
    aperturaDia.setHours(horaApertura, 0, 0, 0);

    const cierreDia = new Date(diaBase);
    cierreDia.setHours(horaCierre, 0, 0, 0);

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
