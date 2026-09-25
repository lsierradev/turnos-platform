import { instanteEnZona, sumarDiasFecha } from './zona-horaria.util';

/**
 * Horario de atencion del taller (Sprint 21). Hasta Sprint 20 era una
 * constante (08:00-18:00 todos los dias); ahora cada taller tiene el suyo
 * por dia de la semana, mas festivos. Lo leen la validacion de la reserva,
 * la grilla, las sugerencias ante conflicto y el panel de carga: si alguno
 * usara otro criterio, el sistema ofreceria horarios que despues rechaza.
 */

/** Minutos desde la medianoche, hora de pared del taller. */
export interface Jornada {
  apertura: number;
  cierre: number;
}

export interface HorarioTaller {
  /** Clave: dia ISO (1 = lunes ... 7 = domingo). Sin clave = cerrado. */
  semana: Map<number, Jornada>;
  /** Clave: YYYY-MM-DD. Valor: motivo. */
  feriados: Map<string, string>;
}

export type DiaDelTaller =
  { abierto: true; jornada: Jornada } | { abierto: false; motivo: string };

/** El que regia hasta Sprint 20; lo usan los procesos sin taller. */
export function horarioPorDefecto(): HorarioTaller {
  const semana = new Map<number, Jornada>();
  for (let d = 1; d <= 7; d += 1)
    semana.set(d, { apertura: 8 * 60, cierre: 18 * 60 });
  return { semana, feriados: new Map() };
}

/** Dia ISO de una fecha calendario (sin zona: es un dia, no un instante). */
export function diaSemanaIso(fechaISO: string): number {
  const [anio, mes, dia] = fechaISO.split('-').map(Number);
  const d = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
  return d === 0 ? 7 : d;
}

export function diaDelTaller(
  horario: HorarioTaller,
  fechaISO: string,
): DiaDelTaller {
  const feriado = horario.feriados.get(fechaISO);
  if (feriado) return { abierto: false, motivo: feriado };
  const jornada = horario.semana.get(diaSemanaIso(fechaISO));
  return jornada
    ? { abierto: true, jornada }
    : { abierto: false, motivo: 'Cerrado' };
}

/** "08:30" <-> 510. */
export function minutosAHora(minutos: number): string {
  return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
}

export function horaAMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

/** Instantes reales de apertura y cierre de un dia, en la zona del taller. */
export function limitesDelDia(
  fechaISO: string,
  jornada: Jornada,
  zona: string,
): { apertura: Date; cierre: Date } {
  return {
    apertura: instanteEnZona(
      fechaISO,
      Math.floor(jornada.apertura / 60),
      jornada.apertura % 60,
      zona,
    ),
    cierre: instanteEnZona(
      fechaISO,
      Math.floor(jornada.cierre / 60),
      jornada.cierre % 60,
      zona,
    ),
  };
}

/**
 * Hasta cuantos dias calendario se busca para juntar `diasAbiertos` dias
 * de atencion (sugerencias ante un 409). Tope para que un taller cerrado
 * por vacaciones no haga recorrer el ano entero.
 */
export const MAX_DIAS_CALENDARIO_BUSQUEDA = 14;

/** Los proximos `cantidad` dias abiertos desde `desde` (inclusive). */
export function proximosDiasAbiertos(
  horario: HorarioTaller,
  desde: string,
  cantidad: number,
): { fecha: string; jornada: Jornada }[] {
  const dias: { fecha: string; jornada: Jornada }[] = [];
  for (
    let i = 0;
    i < MAX_DIAS_CALENDARIO_BUSQUEDA && dias.length < cantidad;
    i += 1
  ) {
    const fecha = sumarDiasFecha(desde, i);
    const dia = diaDelTaller(horario, fecha);
    if (dia.abierto) dias.push({ fecha, jornada: dia.jornada });
  }
  return dias;
}
