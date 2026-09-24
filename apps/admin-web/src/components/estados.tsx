import { useState, type ReactNode } from 'react';
import {
  AlertOctagon,
  Inbox,
  LoaderCircle,
  RotateCw,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { STATUS_SIN_CONEXION, ApiError } from '@/lib/api-client';
import { describirError } from '@/lib/errores';

/*
 * Los tres estados que toda vista con datos remotos tiene que resolver,
 * con la misma forma en todo el panel. Cada vista decide QUE decir; como
 * se ve y como se anuncia a lectores de pantalla queda aca.
 */

// --- Vacio -----------------------------------------------------------------

export function EstadoVacio({
  titulo,
  descripcion,
  icono: Icono = Inbox,
  accion,
}: {
  titulo: string;
  descripcion?: string;
  icono?: LucideIcon;
  accion?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-10 text-center">
      <Icono className="size-8 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium">{titulo}</p>
      {descripcion && (
        <p className="max-w-sm text-sm text-muted-foreground">{descripcion}</p>
      )}
      {accion && <div className="pt-2">{accion}</div>}
    </div>
  );
}

// --- Cargando --------------------------------------------------------------

/**
 * Skeleton con la forma aproximada del contenido que viene, para que al
 * llegar los datos el layout no salte. `etiqueta` es lo que oye un lector de
 * pantalla (el skeleton en si es decorativo).
 */
export function EstadoCargando({
  forma = 'lista',
  filas = 3,
  etiqueta = 'Cargando…',
}: {
  forma?: 'lista' | 'tarjetas' | 'bloque';
  filas?: number;
  etiqueta?: string;
}) {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{etiqueta}</span>
      {forma === 'lista' && (
        <div className="space-y-2" aria-hidden>
          {Array.from({ length: filas }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}
      {forma === 'tarjetas' && (
        <div className="grid gap-4 sm:grid-cols-3" aria-hidden>
          {Array.from({ length: filas }, (_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      )}
      {forma === 'bloque' && <Skeleton className="h-72 w-full" aria-hidden />}
    </div>
  );
}

// --- Error -----------------------------------------------------------------

/**
 * Estado de error con mensaje por tipo (lib/errores.ts) y "Reintentar"
 * cuando tiene sentido (hallazgos 2 y 3 de UX-NOTES.md). Para los errores
 * que no se arreglan reintentando (400, 403, 404) la vista puede pasar una
 * `accionAlternativa` -- p. ej. "Elegir otro tecnico" -- en vez de ofrecer
 * un boton que va a fallar igual.
 */
export function EstadoError({
  error,
  onReintentar,
  accionAlternativa,
}: {
  error: unknown;
  onReintentar?: () => Promise<unknown> | void;
  accionAlternativa?: ReactNode;
}) {
  const { titulo, descripcion, detalle, reintentable } = describirError(error);
  const [reintentando, setReintentando] = useState(false);
  const sinConexion =
    error instanceof ApiError && error.status === STATUS_SIN_CONEXION;
  const Icono = sinConexion ? WifiOff : AlertOctagon;

  async function reintentar() {
    if (!onReintentar) return;
    setReintentando(true);
    try {
      await onReintentar();
    } finally {
      setReintentando(false);
    }
  }

  return (
    <div
      role="alert"
      className="flex gap-3 rounded-lg border border-error/40 bg-error-suave p-4"
    >
      <Icono className="mt-0.5 size-5 shrink-0 text-error" aria-hidden />
      <div className="min-w-0 space-y-1">
        {/* text-destructive: el e2e (hu3) localiza el error por esta clase. */}
        <p className="text-sm font-semibold text-destructive">{titulo}</p>
        <p className="text-sm text-foreground">{descripcion}</p>
        {detalle && (
          <p className="text-xs break-words text-muted-foreground">{detalle}</p>
        )}
        {((reintentable && onReintentar) || accionAlternativa) && (
          <div className="flex flex-wrap gap-2 pt-2">
            {reintentable && onReintentar && (
              <Button
                variant="outline"
                size="sm"
                onClick={reintentar}
                disabled={reintentando}
              >
                <RotateCw
                  className={reintentando ? 'animate-spin' : undefined}
                  aria-hidden
                />
                {reintentando ? 'Reintentando…' : 'Reintentar'}
              </Button>
            )}
            {accionAlternativa}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Actualizando ------------------------------------------------------------

/**
 * Aviso de refetch en segundo plano (hallazgo 5 de UX-NOTES.md). La data
 * anterior sigue visible -- keepPreviousData evita el parpadeo -- y esto
 * explica por que se ve atenuada: se estan trayendo datos nuevos, no esta
 * deshabilitada. Ocupa siempre su lugar (invisible cuando no actua) para
 * que el layout no salte en cada refetch.
 */
export function IndicadorActualizando({ activo }: { activo: boolean }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-1 text-xs text-muted-foreground transition-opacity ${
        activo ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
      {activo ? 'Actualizando…' : ''}
    </span>
  );
}
