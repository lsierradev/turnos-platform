import type { TurnoAgenda } from '@/lib/api-client';
import { formatearDiaCorto, formatearDuracion, hoyISO } from '@/lib/dates';
import {
  bloquesDe,
  CATEGORIA_CLASES,
  CATEGORIA_LABEL,
  formatearRango,
  JORNADA,
  minutosOcupados,
} from './linea-tiempo';

const LARGO_JORNADA = JORNADA.fin - JORNADA.inicio;
const pct = (min: number) => `${((min - JORNADA.inicio) / LARGO_JORNADA) * 100}%`;
const pctLargo = (min: number) => `${(min / LARGO_JORNADA) * 100}%`;

function resumen(turnos: TurnoAgenda[]) {
  const bloques = bloquesDe(turnos);
  const vigentes = bloques.filter((b) => !b.cancelado);
  return { bloques, cantidad: vigentes.length, ocupados: minutosOcupados(bloques) };
}

/**
 * Semana del tecnico. Dos formas segun el ancho, mismo dato:
 *   - >= md: 7 columnas con la jornada vertical, como un calendario.
 *   - <  md: un dia por fila con la jornada en horizontal. Siete columnas
 *     a 390px dejan ~45px por dia: no entra ni la hora.
 * Tocar un dia abre la vista de dia en esa fecha.
 */
export function AgendaSemanal({
  dias,
  onElegirDia,
}: {
  dias: { fecha: string; turnos: TurnoAgenda[] }[];
  onElegirDia: (fecha: string) => void;
}) {
  const hoy = hoyISO();

  return (
    <>
      {/* Escritorio */}
      <div className="hidden grid-cols-7 gap-2 md:grid">
        {dias.map(({ fecha, turnos }) => {
          const { bloques, cantidad, ocupados } = resumen(turnos);
          const esHoy = fecha === hoy;
          return (
            <button
              key={fecha}
              type="button"
              onClick={() => onElegirDia(fecha)}
              aria-label={`${formatearDiaCorto(fecha)}: ${cantidad} turnos. Ver el dia`}
              className={`group flex min-w-0 flex-col rounded-lg border bg-card text-left transition-colors hover:border-primary/60 ${
                esHoy ? 'ring-2 ring-primary' : ''
              }`}
            >
              <div className="border-b px-2 py-1.5">
                <p
                  className={`text-xs font-semibold first-letter:uppercase ${
                    esHoy ? 'text-marca-texto' : 'text-foreground'
                  }`}
                >
                  {formatearDiaCorto(fecha)}
                  {esHoy && <span className="font-normal"> · hoy</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {cantidad === 0 ? 'Libre' : `${cantidad} · ${formatearDuracion(ocupados)}`}
                </p>
              </div>
              <div className="relative h-72 w-full" aria-hidden>
                {/* medio dia de referencia */}
                <div
                  className="absolute inset-x-0 border-t border-dashed border-border"
                  style={{ top: pct(13 * 60) }}
                />
                {bloques.map((b) => {
                  const c = CATEGORIA_CLASES[b.categoria ?? 'ninguna'];
                  const inicio = Math.max(b.inicio, JORNADA.inicio);
                  const fin = Math.min(b.fin, JORNADA.fin);
                  if (fin <= inicio) return null;
                  return (
                    <div
                      key={b.turno.id}
                      title={`${formatearRango(b.inicio, b.fin)} · ${b.turno.servicio?.nombre ?? ''}`}
                      className={`absolute inset-x-1 overflow-hidden rounded-sm border-l-[3px] px-1 text-[10px] leading-tight ${
                        b.cancelado
                          ? `border border-dashed bg-card text-muted-foreground line-through ${c.borde}`
                          : `${c.borde} ${c.fondo} text-foreground`
                      }`}
                      style={{ top: pct(inicio), height: `calc(${pctLargo(fin - inicio)} - 1px)` }}
                    >
                      {/* Icono de categoria desde 30 min (alto >= ~14px). */}
                      {fin - inicio >= 30 && (
                        <span className="flex items-center gap-1 pt-0.5">
                          <c.icono
                            className={`size-3 shrink-0 ${
                              b.cancelado ? 'text-muted-foreground' : c.texto
                            }`}
                          />
                          {fin - inicio >= 45 && (
                            <span className="truncate font-medium">
                              {b.turno.servicio?.nombre}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </button>
          );
        })}
      </div>

      {/* Celular */}
      <ul className="space-y-2 md:hidden">
        {dias.map(({ fecha, turnos }) => {
          const { bloques, cantidad, ocupados } = resumen(turnos);
          const esHoy = fecha === hoy;
          return (
            <li key={fecha}>
              <button
                type="button"
                onClick={() => onElegirDia(fecha)}
                className={`w-full space-y-2 rounded-lg border bg-card p-3 text-left ${
                  esHoy ? 'ring-2 ring-primary' : ''
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={`text-sm font-semibold first-letter:uppercase ${
                      esHoy ? 'text-marca-texto' : 'text-foreground'
                    }`}
                  >
                    {formatearDiaCorto(fecha)}
                    {esHoy && <span className="font-normal"> · hoy</span>}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {cantidad === 0
                      ? 'Sin turnos'
                      : `${cantidad} turno${cantidad === 1 ? '' : 's'} · ${formatearDuracion(ocupados)}`}
                  </span>
                </div>
                <div className="relative h-5 overflow-hidden rounded bg-muted" aria-hidden>
                  {bloques
                    .filter((b) => !b.cancelado)
                    .map((b) => {
                      const inicio = Math.max(b.inicio, JORNADA.inicio);
                      const fin = Math.min(b.fin, JORNADA.fin);
                      if (fin <= inicio) return null;
                      return (
                        <div
                          key={b.turno.id}
                          className={`absolute inset-y-0 border-x border-card ${
                            CATEGORIA_CLASES[b.categoria ?? 'ninguna'].punto
                          }`}
                          style={{ left: pct(inicio), width: pctLargo(fin - inicio) }}
                        />
                      );
                    })}
                </div>
                <div className="flex justify-between font-mono text-[10px] text-muted-foreground" aria-hidden>
                  <span>08:00</span>
                  <span>13:00</span>
                  <span>18:00</span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      <LeyendaCategorias />
    </>
  );
}

export function LeyendaCategorias() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 pt-3 text-xs text-muted-foreground" aria-label="Categorias de servicio">
      {(Object.keys(CATEGORIA_LABEL) as (keyof typeof CATEGORIA_LABEL)[]).map((c) => {
        const { icono: Icono, texto, punto } = CATEGORIA_CLASES[c];
        return (
          <li key={c} className="flex items-center gap-1.5">
            <span className={`size-2.5 rounded-sm ${punto}`} aria-hidden />
            <Icono className={`size-3.5 ${texto}`} aria-hidden />
            {CATEGORIA_LABEL[c]}
          </li>
        );
      })}
    </ul>
  );
}
