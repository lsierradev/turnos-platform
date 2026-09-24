// Zona horaria del TALLER en todo el frontend (Sprint 12). Tiene que ser la
// misma que TZ_NEGOCIO de reservas-service: la API recibe fechas YYYY-MM-DD
// como dias del taller y devuelve instantes en UTC, y es este archivo el que
// traduce entre ambos mundos.
//
// Ni UTC (hasta Sprint 11 la agenda mostraba un turno de las 8:00 locales
// como 13:00) ni la zona del navegador: un admin que abre el panel de viaje
// tiene que ver la agenda del taller, no la de donde esta el.
export const ZONA_NEGOCIO =
  import.meta.env.VITE_TZ_NEGOCIO?.trim() || 'America/Bogota';

const formateador = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONA_NEGOCIO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  // h23 y no hour12:false: con hour12:false algunos navegadores devuelven
  // "24:00" para la medianoche.
  hourCycle: 'h23',
});

function partes(instante: Date): Record<string, string> {
  const resultado: Record<string, string> = {};
  for (const p of formateador.formatToParts(instante)) {
    resultado[p.type] = p.value;
  }
  return resultado;
}

/** Hoy (YYYY-MM-DD) en la zona del taller. */
export function hoyISO(): string {
  const { year, month, day } = partes(new Date());
  return `${year}-${month}-${day}`;
}

// Aritmetica de calendario pura sobre YYYY-MM-DD: Date.UTC se usa solo como
// calculadora de fechas, sin horas de por medio, asi que no depende de
// ninguna zona.
export function sumarDiasISO(fechaISO: string, dias: number): string {
  const fecha = new Date(`${fechaISO}T00:00:00.000Z`);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

/** HH:MM de un instante de la API, en la hora del taller. */
export function formatearHora(iso: string): string {
  const { hour, minute } = partes(new Date(iso));
  return `${hour}:${minute}`;
}

export function formatearDiaMes(fechaISO: string): string {
  return `${fechaISO.slice(8, 10)}/${fechaISO.slice(5, 7)}`;
}
