import type { TurnoAgenda } from '@/lib/api-client';
import { minutosDelDia } from '@/lib/dates';

/**
 * Jornada del taller en minutos desde la medianoche local: 08:00-18:00,
 * el mismo horario laboral que valida reservas-service
 * (HORA_APERTURA_DEFAULT / HORA_CIERRE_DEFAULT). Si uno cambia, cambiar el
 * otro: si no, la linea de tiempo dibuja huecos "libres" que el backend no
 * deja reservar.
 */
export const JORNADA = { inicio: 8 * 60, fin: 18 * 60 } as const;

/** Un hueco mas corto que esto no se muestra: no entra ningun servicio. */
export const HUECO_MINIMO_MIN = 15;

export type Categoria = 'mecanica' | 'electrica' | 'latoneria';

export interface Bloque {
  turno: TurnoAgenda;
  inicio: number;
  fin: number;
  categoria: Categoria | null;
  /** Cancelado: se muestra, pero NO ocupa la agenda. */
  cancelado: boolean;
}

export interface Hueco {
  inicio: number;
  fin: number;
}

export function bloquesDe(turnos: TurnoAgenda[]): Bloque[] {
  return turnos
    .map((turno) => {
      const inicio = minutosDelDia(turno.rangoTiempo.inicio);
      let fin = minutosDelDia(turno.rangoTiempo.fin);
      // Un turno que termina a la medianoche local daria fin = 0.
      if (fin <= inicio) fin = 24 * 60;
      return {
        turno,
        inicio,
        fin,
        categoria: turno.servicio?.categoria ?? null,
        cancelado: turno.estado === 'cancelado',
      };
    })
    .sort((a, b) => a.inicio - b.inicio);
}

/**
 * Huecos libres dentro de la jornada, entre los turnos que ocupan tiempo.
 * Los cancelados no cuentan: su horario quedo libre de nuevo.
 */
export function huecosLibres(bloques: Bloque[]): Hueco[] {
  const ocupados = bloques
    .filter((b) => !b.cancelado)
    .map((b) => ({
      inicio: Math.max(b.inicio, JORNADA.inicio),
      fin: Math.min(b.fin, JORNADA.fin),
    }))
    .filter((b) => b.fin > b.inicio);

  const huecos: Hueco[] = [];
  let cursor: number = JORNADA.inicio;
  for (const o of ocupados) {
    if (o.inicio - cursor >= HUECO_MINIMO_MIN) {
      huecos.push({ inicio: cursor, fin: o.inicio });
    }
    cursor = Math.max(cursor, o.fin);
  }
  if (JORNADA.fin - cursor >= HUECO_MINIMO_MIN) {
    huecos.push({ inicio: cursor, fin: JORNADA.fin });
  }
  return huecos;
}

export function minutosOcupados(bloques: Bloque[]): number {
  return bloques
    .filter((b) => !b.cancelado)
    .reduce(
      (total, b) =>
        total +
        Math.max(0, Math.min(b.fin, JORNADA.fin) - Math.max(b.inicio, JORNADA.inicio)),
      0,
    );
}

/** "08:30" desde minutos del dia. */
export function hhmm(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "08:30–09:15" (guion corto sin espacios, como el resto del panel). */
export function formatearRango(inicio: number, fin: number): string {
  return `${hhmm(inicio)}–${hhmm(fin)}`;
}

export const CATEGORIA_LABEL: Record<Categoria, string> = {
  mecanica: 'Mecanica',
  electrica: 'Electrica',
  latoneria: 'Latoneria',
};

// Clases completas por categoria (Tailwind no genera clases armadas en
// runtime). Sin categoria (servicio no cargado) cae al neutro.
export const CATEGORIA_CLASES: Record<Categoria | 'ninguna', { borde: string; fondo: string; punto: string }> = {
  mecanica: {
    borde: 'border-categoria-mecanica',
    fondo: 'bg-categoria-mecanica-suave',
    punto: 'bg-categoria-mecanica',
  },
  electrica: {
    borde: 'border-categoria-electrica',
    fondo: 'bg-categoria-electrica-suave',
    punto: 'bg-categoria-electrica',
  },
  latoneria: {
    borde: 'border-categoria-latoneria',
    fondo: 'bg-categoria-latoneria-suave',
    punto: 'bg-categoria-latoneria',
  },
  ninguna: {
    borde: 'border-chart-5',
    fondo: 'bg-muted',
    punto: 'bg-chart-5',
  },
};

export const ESTADO_TURNO_LABEL: Record<string, string> = {
  programado: 'Programado',
  atendido: 'Atendido',
  no_asistio: 'No asistio',
  cancelado: 'Cancelado',
};
