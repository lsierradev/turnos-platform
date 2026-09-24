import type { KpiDia, KpisResponse, KpisResumen } from '@/lib/api-client';
import type { Celda } from '@/lib/csv';

export function formatearPorcentaje(valor: number | null): string {
  return valor === null ? '—' : `${Math.round(valor * 100)}%`;
}

export function formatearMinutos(valor: number | null): string {
  return valor === null ? '—' : `${String(valor).replace('.', ',')} min`;
}

export function diasDelRango(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
}

/** "ayer", "el dia anterior" o "los 7 dias anteriores". */
export function nombrePeriodoAnterior(from: string, to: string, hoy: string): string {
  const dias = diasDelRango(from, to);
  if (dias === 1) return from === hoy ? 'ayer' : 'el dia anterior';
  return `los ${dias} dias anteriores`;
}

export type Direccion = 'sube' | 'baja' | 'igual';

export interface Comparacion {
  direccion: Direccion | null;
  /** Texto completo, sin depender de color ni de la flecha. */
  texto: string;
}

/**
 * Diferencia contra el periodo anterior, en la unidad natural de cada KPI:
 * puntos porcentuales para la tasa (de 60% a 70% es +10 pts, no +17%),
 * minutos para el tiempo, y cantidad (con %) para los turnos.
 *
 * No dice si el cambio es bueno o malo: menos minutos de servicio puede ser
 * eficiencia o trabajos mas simples. La flecha y el texto describen, no
 * juzgan -- y por eso tampoco se pinta de verde/rojo.
 */
export function comparar(
  tipo: 'tasa' | 'minutos' | 'cantidad',
  actual: number | null,
  previo: number | null,
  periodo: string,
): Comparacion {
  if (actual === null || previo === null) {
    return {
      direccion: null,
      texto: previo === null ? `Sin datos en ${periodo} para comparar` : `Sin datos para comparar con ${periodo}`,
    };
  }

  let delta: number;
  let texto: string;
  if (tipo === 'tasa') {
    delta = Math.round((actual - previo) * 100);
    texto = `${delta > 0 ? '+' : ''}${delta} pts vs. ${periodo} (${formatearPorcentaje(previo)})`;
  } else if (tipo === 'minutos') {
    delta = Math.round((actual - previo) * 10) / 10;
    texto = `${delta > 0 ? '+' : ''}${String(delta).replace('.', ',')} min vs. ${periodo} (${formatearMinutos(previo)})`;
  } else {
    delta = actual - previo;
    const pct = previo === 0 ? null : Math.round((delta / previo) * 100);
    texto =
      `${delta > 0 ? '+' : ''}${delta}` +
      (pct === null ? '' : ` (${pct > 0 ? '+' : ''}${pct}%)`) +
      ` vs. ${periodo} (${previo})`;
  }

  if (delta === 0) return { direccion: 'igual', texto: `Igual que ${periodo} (${tipo === 'tasa' ? formatearPorcentaje(previo) : tipo === 'minutos' ? formatearMinutos(previo) : previo})` };
  return { direccion: delta > 0 ? 'sube' : 'baja', texto };
}

export function hayCierres(serie: KpiDia[]): boolean {
  return serie.some((d) => d.tasaAsistencia !== null);
}

export function hayMediciones(serie: KpiDia[]): boolean {
  return serie.some((d) => d.turnosMedidos > 0);
}

/** Filas del CSV: una por dia + total del periodo. */
export function filasCsv(datos: KpisResponse, tecnico: string): Celda[][] {
  const pct = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 10);
  const fila = (etiqueta: string, d: KpiDia | KpisResumen): Celda[] => {
    const esDia = 'fecha' in d;
    return [
      etiqueta,
      esDia ? d.atendidos : d.turnosAtendidos,
      esDia ? d.noAsistio : d.turnosNoAsistio,
      esDia ? d.cancelados : d.turnosCancelados,
      esDia ? d.programados : d.turnosProgramados,
      pct(d.tasaAsistencia),
      d.minutosPromedioServicio,
      d.turnosMedidos,
    ];
  };
  return [
    [`KPIs ${datos.rango.from} a ${datos.rango.to} (${datos.zonaHoraria}) - ${tecnico}`],
    [
      'Dia',
      'Atendidos',
      'No asistio',
      'Cancelados',
      'Sin cerrar',
      'Asistencia (%)',
      'Tiempo promedio (min)',
      'Turnos medidos',
    ],
    ...datos.serie.map((d) => fila(d.fecha, d)),
    fila('Total', datos.resumen),
  ];
}
