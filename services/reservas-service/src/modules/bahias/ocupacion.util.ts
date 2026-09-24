import {
  HORA_APERTURA_DEFAULT,
  HORA_CIERRE_DEFAULT,
} from '../appointments/sugerencias-horarios.util';

/**
 * Jornada contra la que se mide la ocupacion: el MISMO horario laboral que
 * valida POST /appointments (hora de pared de TZ_NEGOCIO). Si se midiera
 * contra 24 h, una bahia llena de 8 a 18 figuraria al 42%.
 */
export const JORNADA = {
  apertura: HORA_APERTURA_DEFAULT,
  cierre: HORA_CIERRE_DEFAULT,
  minutos: (HORA_CIERRE_DEFAULT - HORA_APERTURA_DEFAULT) * 60,
} as const;

/**
 * Umbrales de alerta. Viajan en la respuesta para que el front no tenga
 * su propia copia: si se ajustan aca, el panel cambia solo.
 *
 * - alta (80%): con 2 h o menos libres en la jornada ya no entra un
 *   servicio largo (latoneria dura 2 h) y cualquier demora se come el
 *   resto del dia.
 * - completa (100%): no queda ningun minuto libre en la jornada.
 */
export const UMBRALES = { alta: 0.8, completa: 1 } as const;

export type NivelOcupacion = 'libre' | 'normal' | 'alta' | 'completa';

/** Fraccion 0..1 de la jornada ocupada, redondeada a 3 decimales. */
export function calcularOcupacion(minutosOcupados: number): number {
  const fraccion = minutosOcupados / JORNADA.minutos;
  // Tope en 1: con la validacion de horario (Sprint 9) no deberia pasar,
  // pero turnos viejos o un cambio de jornada no pueden dar un 130%.
  return Math.round(Math.min(Math.max(fraccion, 0), 1) * 1000) / 1000;
}

export function nivelOcupacion(
  ocupacion: number,
  turnos: number,
): NivelOcupacion {
  if (turnos === 0) return 'libre';
  if (ocupacion >= UMBRALES.completa) return 'completa';
  if (ocupacion >= UMBRALES.alta) return 'alta';
  return 'normal';
}

export function esAlerta(nivel: NivelOcupacion): boolean {
  return nivel === 'alta' || nivel === 'completa';
}

/** "08:00" para parametros SQL de tipo time. */
export function horaSql(hora: number): string {
  return `${String(hora).padStart(2, '0')}:00`;
}
