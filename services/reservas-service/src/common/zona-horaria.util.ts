/**
 * Zona horaria de NEGOCIO (Sprint 12).
 *
 * El backend guarda y compara instantes en UTC, y eso no cambia. Lo que
 * cambia es QUE instantes corresponden a "las 8:00" o a "el 24 de
 * septiembre": eso lo define la zona del taller, no UTC ni la zona del
 * proceso. Hasta Sprint 11 se usaba UTC para todo, y en Colombia (UTC-5)
 * el horario laboral quedaba en 3:00-13:00 local y el "hoy" del dashboard
 * cambiaba a las 19:00.
 *
 * REGLA: nada de getHours()/setHours()/toLocaleString() sin zona. Todo lo
 * que dependa de la hora de pared pasa por estas funciones, que reciben la
 * zona explicita y la resuelven con Intl -- el resultado es el mismo corra
 * el proceso en UTC, en Bogota o en Tokio.
 */

const ZONA_DEFAULT = 'America/Bogota';

const formateadores = new Map<string, Intl.DateTimeFormat>();

function formateador(zona: string): Intl.DateTimeFormat {
  let f = formateadores.get(zona);
  if (!f) {
    // Lanza RangeError si la zona no existe en la base IANA de Node.
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zona,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      // h23 y no hour12:false: con hour12:false algunos runtimes devuelven
      // "24" para la medianoche, lo que correria el dia.
      hourCycle: 'h23',
    });
    formateadores.set(zona, f);
  }
  return f;
}

/**
 * Se lee del entorno en cada llamada (mismo criterio que
 * opcionesJobNotificacion): los tests la cambian por caso sin depender del
 * orden de carga de los modulos. Una zona invalida falla fuerte en vez de
 * caer silenciosamente a UTC, que es justo el bug que esto viene a cerrar.
 */
export function zonaHorariaNegocio(): string {
  const zona = process.env.TZ_NEGOCIO?.trim() || ZONA_DEFAULT;
  try {
    formateador(zona);
  } catch {
    throw new Error(
      `TZ_NEGOCIO="${zona}" no es una zona horaria IANA valida (ej: America/Bogota).`,
    );
  }
  return zona;
}

export interface PartesLocales {
  anio: number;
  mes: number; // 1-12
  dia: number;
  hora: number; // 0-23
  minuto: number;
  segundo: number;
}

export function partesEnZona(instante: Date, zona: string): PartesLocales {
  const partes: Record<string, number> = {};
  for (const p of formateador(zona).formatToParts(instante)) {
    if (p.type !== 'literal') {
      partes[p.type] = Number(p.value);
    }
  }
  return {
    anio: partes.year,
    mes: partes.month,
    dia: partes.day,
    hora: partes.hour,
    minuto: partes.minute,
    segundo: partes.second,
  };
}

function dosDigitos(n: number): string {
  return String(n).padStart(2, '0');
}

/** Fecha calendario (YYYY-MM-DD) en la que cae `instante` en `zona`. */
export function fechaEnZona(instante: Date, zona: string): string {
  const { anio, mes, dia } = partesEnZona(instante, zona);
  return `${anio}-${dosDigitos(mes)}-${dosDigitos(dia)}`;
}

/** Hora de pared HH:MM de `instante` en `zona`. */
export function horaEnZona(instante: Date, zona: string): string {
  const { hora, minuto } = partesEnZona(instante, zona);
  return `${dosDigitos(hora)}:${dosDigitos(minuto)}`;
}

/**
 * Aritmetica de CALENDARIO sobre YYYY-MM-DD. Usa Date.UTC solo como
 * calculadora de fechas (sin horas de por medio), asi que no depende de
 * ninguna zona ni se ve afectada por cambios de horario de verano.
 */
export function sumarDiasFecha(fechaISO: string, dias: number): string {
  const [anio, mes, dia] = fechaISO.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia + dias))
    .toISOString()
    .slice(0, 10);
}

function offsetMs(instante: Date, zona: string): number {
  const p = partesEnZona(instante, zona);
  const comoUtc = Date.UTC(
    p.anio,
    p.mes - 1,
    p.dia,
    p.hora,
    p.minuto,
    p.segundo,
  );
  // Se descartan los ms del instante: las partes locales no los traen.
  return comoUtc - Math.floor(instante.getTime() / 1000) * 1000;
}

/**
 * Instante (UTC) que corresponde a la hora de pared `hora:minuto` del dia
 * `fechaISO` en `zona`.
 *
 * Se estima con el offset del instante "como si fuera UTC" y se corrige una
 * vez con el offset del resultado: con eso alcanza para zonas con horario
 * de verano. Bogota no lo tiene, pero TZ_NEGOCIO es configurable. Para una
 * hora que no existe (el salto de primavera) devuelve la hora posterior al
 * salto; para una repetida (otonio), la primera ocurrencia.
 */
export function instanteEnZona(
  fechaISO: string,
  hora: number,
  minuto: number,
  zona: string,
): Date {
  const [anio, mes, dia] = fechaISO.split('-').map(Number);
  const comoUtc = Date.UTC(anio, mes - 1, dia, hora, minuto);
  const estimado = comoUtc - offsetMs(new Date(comoUtc), zona);
  const corregido = comoUtc - offsetMs(new Date(estimado), zona);
  return new Date(corregido);
}

/** Inicio (00:00 local) del dia `fechaISO` en `zona`, como instante UTC. */
export function inicioDelDiaEnZona(fechaISO: string, zona: string): Date {
  return instanteEnZona(fechaISO, 0, 0, zona);
}

const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normaliza lo que manda un cliente como "dia" a una fecha de negocio:
 * - YYYY-MM-DD se toma tal cual: ES el dia del taller, no medianoche UTC.
 * - Un instante ISO completo se ubica en el dia de negocio en que cae.
 * - Sin valor, hoy en la zona de negocio.
 */
export function fechaDeNegocio(
  valor: string | undefined,
  zona: string,
): string {
  if (!valor) {
    return fechaEnZona(new Date(), zona);
  }
  if (SOLO_FECHA.test(valor)) {
    return valor;
  }
  return fechaEnZona(new Date(valor), zona);
}
