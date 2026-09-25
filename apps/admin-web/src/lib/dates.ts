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

/** Fecha (YYYY-MM-DD) del taller en la que cae un instante de la API. */
export function fechaDeInstante(iso: string | Date): string {
  const { year, month, day } = partes(new Date(iso));
  return `${year}-${month}-${day}`;
}

/**
 * Minutos desde la medianoche del taller: la coordenada vertical de la
 * linea de tiempo. 14:30 en Bogota -> 870, venga el instante en Z o con
 * offset.
 */
export function minutosDelDia(iso: string | Date): number {
  const { hour, minute } = partes(new Date(iso));
  return Number(hour) * 60 + Number(minute);
}

/** 0 = lunes ... 6 = domingo, para una fecha de calendario. */
function diaDeSemana(fechaISO: string): number {
  return (new Date(`${fechaISO}T00:00:00.000Z`).getUTCDay() + 6) % 7;
}

/** Lunes de la semana de `fechaISO` (la semana del taller arranca el lunes). */
export function inicioDeSemana(fechaISO: string): string {
  return sumarDiasISO(fechaISO, -diaDeSemana(fechaISO));
}

// Fechas de calendario (sin hora): se formatean en UTC a proposito, porque
// "2026-09-24" ya ES el dia del taller; pasarlo por otra zona lo correria.
const formatoDia = new Intl.DateTimeFormat('es', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
});
const formatoLargo = new Intl.DateTimeFormat('es', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/** "jue 24" */
export function formatearDiaCorto(fechaISO: string): string {
  return formatoDia.format(new Date(`${fechaISO}T12:00:00.000Z`)).replace('.', '');
}

/** "jueves, 24 de septiembre" */
export function formatearFechaLarga(fechaISO: string): string {
  return formatoLargo.format(new Date(`${fechaISO}T12:00:00.000Z`));
}

export function formatearDuracion(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/**
 * Instante (ISO) de la hora de pared `hora` (HH:MM) del dia `fechaISO` en
 * la zona del taller (Sprint 22: fecha probable de entrega). Misma
 * estimacion que instanteEnZona del backend: se asume UTC, se mide el
 * offset y se corrige una vez (alcanza para zonas con horario de verano).
 */
export function instanteDelTaller(fechaISO: string, hora: string): string {
  const [anio, mes, dia] = fechaISO.split('-').map(Number);
  const [h, m] = hora.split(':').map(Number);
  const comoUtc = Date.UTC(anio, mes - 1, dia, h, m);
  const offset = (instante: number) => {
    const p = partes(new Date(instante));
    const local = Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
    );
    return local - Math.floor(instante / 60_000) * 60_000;
  };
  const estimado = comoUtc - offset(comoUtc);
  return new Date(comoUtc - offset(estimado)).toISOString();
}

/** "jueves, 24 de septiembre · 14:30" de un instante, en hora del taller. */
export function formatearFechaHora(iso: string): string {
  return `${formatearFechaLarga(fechaDeInstante(iso))} · ${formatearHora(iso)}`;
}

const formatoConAnio = new Intl.DateTimeFormat('es', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** "21 de septiembre de 2027": para fechas que pueden caer en otro ano (vencimientos). */
export function formatearFechaConAnio(fechaISO: string): string {
  return formatoConAnio.format(new Date(`${fechaISO}T12:00:00.000Z`));
}
