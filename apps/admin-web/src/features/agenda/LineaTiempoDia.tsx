import { useEffect, useState } from 'react';
import { Ban, CheckCircle2, UserX } from 'lucide-react';
import { formatearDuracion, minutosDelDia } from '@/lib/dates';
import type { TurnoAgenda } from '@/lib/api-client';
import {
  bloquesDe,
  CATEGORIA_CLASES,
  CATEGORIA_LABEL,
  formatearRango,
  hhmm,
  huecosLibres,
  JORNADA,
  type Bloque,
} from './linea-tiempo';

/** Minuto actual del taller; se refresca solo para mover la marca "ahora". */
function useMinutoActual(activo: boolean): number {
  const [minuto, setMinuto] = useState(() => minutosDelDia(new Date()));
  useEffect(() => {
    if (!activo) return;
    const id = window.setInterval(() => setMinuto(minutosDelDia(new Date())), 30_000);
    return () => window.clearInterval(id);
  }, [activo]);
  return minuto;
}

// Posicion vertical: todo se expresa en multiplos de --hora (el alto de una
// hora), asi el mismo calculo sirve en celular y en escritorio.
const top = (min: number, desde: number) => `calc(var(--hora) * ${(min - desde) / 60})`;
const alto = (min: number) => `calc(var(--hora) * ${min / 60})`;

function BloqueTurno({ bloque, desde }: { bloque: Bloque; desde: number }) {
  const { turno, inicio, fin, categoria, cancelado } = bloque;
  const clases = CATEGORIA_CLASES[categoria ?? 'ninguna'];
  const duracion = fin - inicio;
  const servicio = turno.servicio?.nombre ?? 'Servicio';
  const bahia = turno.bahia?.nombre ?? 'Bahia';
  const categoriaTxt = categoria ? CATEGORIA_LABEL[categoria] : undefined;
  const rango = formatearRango(inicio, fin);
  // Tres formatos segun el alto disponible: una linea (< 45 min), dos
  // (< 1 h) o tres. Con una hora de 72px, 45 min son 54px: entran dos
  // lineas, no tres.
  const compacto = duracion < 45;
  const mediano = !compacto && duracion < 60;

  const estadoIcono =
    turno.estado === 'atendido' ? (
      <CheckCircle2 className="size-3.5 shrink-0" aria-label="Atendido" />
    ) : turno.estado === 'no_asistio' ? (
      <UserX className="size-3.5 shrink-0" aria-label="No asistio" />
    ) : cancelado ? (
      <Ban className="size-3.5 shrink-0" aria-label="Cancelado" />
    ) : null;

  return (
    <li
      aria-label={`${rango}, ${servicio}, ${bahia}${categoriaTxt ? `, ${categoriaTxt}` : ''}${
        turno.estado !== 'programado' ? `, ${turno.estado.replace('_', ' ')}` : ''
      }`}
      className={`absolute inset-x-1 overflow-hidden rounded-md border-l-4 px-2 text-xs shadow-xs sm:inset-x-2 ${
        cancelado
          ? // Cancelado: sin relleno ni opacidad (bajaria el contraste del
            // texto); borde punteado y texto tachado.
            `border border-dashed bg-card text-muted-foreground line-through ${clases.borde}`
          : `${clases.borde} ${clases.fondo} text-foreground`
      } ${compacto ? 'flex items-center gap-2 py-0.5' : 'py-1.5'}`}
      style={{
        top: top(inicio, desde),
        height: `calc(${alto(duracion)} - 2px)`,
        // Un cancelado queda debajo de un turno vigente en el mismo horario.
        zIndex: cancelado ? 1 : 2,
      }}
    >
      {compacto ? (
        <>
          <span className="shrink-0 font-mono font-semibold" aria-hidden>
            {hhmm(inicio)}
          </span>
          <span className="truncate font-medium" aria-hidden>
            {servicio}
            <span className="font-normal text-muted-foreground"> · {bahia}</span>
          </span>
          {estadoIcono}
        </>
      ) : mediano ? (
        <div aria-hidden className="space-y-0.5">
          <p className="flex items-center gap-1.5 font-mono font-semibold">
            {rango}
            {estadoIcono}
          </p>
          <p className="truncate font-medium">
            {servicio}
            <span className="font-normal text-muted-foreground"> · {bahia}</span>
          </p>
        </div>
      ) : (
        <div aria-hidden className="space-y-0.5">
          <p className="flex items-center gap-1.5 font-mono font-semibold">
            {rango}
            {estadoIcono}
          </p>
          <p className="truncate text-sm font-medium">{servicio}</p>
          <p className="truncate text-muted-foreground">
            {bahia}
            {categoriaTxt && ` · ${categoriaTxt}`}
          </p>
        </div>
      )}
    </li>
  );
}

/**
 * Agenda de un dia como linea de tiempo vertical (Sprint 15): bloques con
 * alto proporcional a la duracion, color por categoria de servicio, huecos
 * libres a la vista y marca de "ahora" si el dia es hoy.
 */
export function LineaTiempoDia({
  turnos,
  esHoy,
}: {
  turnos: TurnoAgenda[];
  esHoy: boolean;
}) {
  const bloques = bloquesDe(turnos);
  const huecos = huecosLibres(bloques);
  const ahora = useMinutoActual(esHoy);

  // La jornada define el rango visible, pero si hay un turno fuera de ella
  // (cargado antes de la validacion del Sprint 9) se estira para mostrarlo.
  const desde = Math.floor(Math.min(JORNADA.inicio, ...bloques.map((b) => b.inicio)) / 60) * 60;
  const hasta = Math.ceil(Math.max(JORNADA.fin, ...bloques.map((b) => b.fin)) / 60) * 60;
  const horas = Array.from({ length: (hasta - desde) / 60 + 1 }, (_, i) => desde + i * 60);
  const ahoraVisible = esHoy && ahora >= desde && ahora <= hasta;

  return (
    <div
      className="relative flex [--hora:4.5rem]"
      style={{ height: `calc(var(--hora) * ${(hasta - desde) / 60})` }}
    >
      {/* Escala de horas */}
      <div className="relative w-11 shrink-0 sm:w-14" aria-hidden>
        {horas.map((h) => (
          <span
            key={h}
            className="absolute right-2 -translate-y-1/2 font-mono text-xs text-muted-foreground"
            style={{ top: top(h, desde) }}
          >
            {hhmm(h)}
          </span>
        ))}
      </div>

      <div className="relative flex-1 border-l">
        {/* Grilla de horas y medias horas */}
        {horas.map((h) => (
          <div key={h} aria-hidden>
            <div className="absolute inset-x-0 border-t" style={{ top: top(h, desde) }} />
            {h < hasta && (
              <div
                className="absolute inset-x-0 border-t border-dashed border-border/60"
                style={{ top: top(h + 30, desde) }}
              />
            )}
          </div>
        ))}

        {/* Lo que ya paso del dia, sombreado */}
        {ahoraVisible && (
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 bg-muted/60"
            style={{ height: alto(ahora - desde) }}
          />
        )}

        {/* Huecos libres: punteados y con texto (forma) + punto en el verde de
            estado-libre (color). Desde Sprint 15.1 ese verde se distingue de
            la categoria electrica tambien con daltonismo; ver index.css. */}
        <ul aria-label="Huecos libres">
          {huecos.map((h) => (
            <li
              key={h.inicio}
              className="absolute inset-x-1 flex items-center justify-center rounded-md border-2 border-dashed border-input text-xs text-muted-foreground sm:inset-x-2"
              style={{ top: top(h.inicio, desde), height: `calc(${alto(h.fin - h.inicio)} - 2px)` }}
            >
              <span className="inline-flex items-center gap-1.5 rounded bg-card px-1.5">
                <span className="size-2 rounded-full bg-estado-libre" aria-hidden />
                Libre · {formatearDuracion(h.fin - h.inicio)}
                <span className="sr-only">
                  {' '}
                  de {hhmm(h.inicio)} a {hhmm(h.fin)}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <ol aria-label="Turnos del dia">
          {bloques.map((b) => (
            <BloqueTurno key={b.turno.id} bloque={b} desde={desde} />
          ))}
        </ol>

        {ahoraVisible && (
          <div
            className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
            style={{ top: top(ahora, desde) }}
          >
            <span className="-ml-1.5 size-3 shrink-0 rounded-full bg-marca" aria-hidden />
            <span className="h-0.5 flex-1 bg-marca" aria-hidden />
            <span className="absolute right-1 -translate-y-1/2 rounded bg-card px-1.5 font-mono text-xs font-semibold text-marca-texto shadow-xs">
              Ahora {hhmm(ahora)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
