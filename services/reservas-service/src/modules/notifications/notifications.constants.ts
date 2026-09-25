import { JobOptions } from 'bull';

export const NOMBRE_COLA_NOTIFICACIONES = 'notificaciones';

const INTENTOS_DEFAULT = 3;
const BACKOFF_MS_DEFAULT = 5000;

/**
 * Se lee del entorno en cada llamada, no una sola vez al importar el modulo:
 * el test de integracion baja el backoff a milisegundos para no esperar la
 * curva exponencial real, y si esto fuera una const evaluada al import
 * dependeria del orden en que Jest carga los modulos.
 */
export function opcionesJobNotificacion(): JobOptions {
  return {
    attempts: Number(process.env.NOTIFICACIONES_INTENTOS ?? INTENTOS_DEFAULT),
    backoff: {
      type: 'exponential',
      delay: Number(
        process.env.NOTIFICACIONES_BACKOFF_MS ?? BACKOFF_MS_DEFAULT,
      ),
    },
  };
}

export interface NotificacionJobData {
  notificacionId: string;
  mensaje: string;
  /** Asunto del correo (Sprint 22); sin el, el del recordatorio. */
  asunto?: string;
}
