import { fechaEnZona, horaEnZona } from './zona-horaria.util';

/**
 * Politica de cancelacion (Sprint 22).
 *
 * Cancelar o reprogramar es gratis hasta `ventanaHoras` antes del inicio
 * del turno; despues, o faltando, suma un strike. Con STRIKES_PARA_PREPAGO
 * strikes vigentes en un taller, el cliente solo reserva ahi pagando el
 * 100% por adelantado.
 */
export const STRIKES_PARA_PREPAGO = 3;

export interface EvaluacionCancelacion {
  /** true: dentro de la ventana, sin strike. */
  gratis: boolean;
  /** Ultimo instante en que cancelar es gratis. */
  limite: Date;
  /** El limite en hora de pared del taller: "2026-09-30 06:00". */
  limiteLocal: string;
  /** Cuanto falta para el turno, en minutos enteros (negativo si ya empezo). */
  anticipacionMinutos: number;
}

/**
 * Compara INSTANTES, nunca horas de pared: "4 horas antes" es tiempo
 * transcurrido, y asi no importa la zona del proceso ni con que offset
 * mando el cliente la hora (Z, -05:00, ...). La zona del taller se usa
 * solo para expresar el limite como lo lee la gente del taller.
 *
 * El borde es inclusivo: a exactamente `ventanaHoras` del turno todavia
 * es gratis ("hasta 4 horas antes"). Los milisegundos cuentan: el caso de
 * 3 h 59 min 59,999 s ya no lo es.
 */
export function evaluarCancelacion(args: {
  inicioTurno: Date;
  ahora: Date;
  ventanaHoras: number;
  zona: string;
}): EvaluacionCancelacion {
  const { inicioTurno, ahora, ventanaHoras, zona } = args;
  const limite = new Date(inicioTurno.getTime() - ventanaHoras * 3_600_000);
  return {
    gratis: ahora.getTime() <= limite.getTime(),
    limite,
    limiteLocal: `${fechaEnZona(limite, zona)} ${horaEnZona(limite, zona)}`,
    anticipacionMinutos: Math.floor(
      (inicioTurno.getTime() - ahora.getTime()) / 60_000,
    ),
  };
}

/** 239 -> "3 h 59 min"; 240 -> "4 h"; 45 -> "45 min". */
export function formatearAnticipacion(minutos: number): string {
  const m = Math.max(0, minutos);
  const horas = Math.floor(m / 60);
  const resto = m % 60;
  if (horas === 0) return `${resto} min`;
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
}
