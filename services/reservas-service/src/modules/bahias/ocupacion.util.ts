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

/**
 * Fraccion 0..1 de la jornada ocupada, redondeada a 3 decimales. La
 * jornada es la del taller ESE dia (Sprint 21): el mismo horario que valida
 * POST /appointments. Si se midiera contra 24 h, una bahia llena de 8 a 18
 * figuraria al 42%. Dia cerrado (jornada 0): 0.
 */
export function calcularOcupacion(
  minutosOcupados: number,
  minutosJornada: number,
): number {
  if (minutosJornada <= 0) return 0;
  const fraccion = minutosOcupados / minutosJornada;
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
