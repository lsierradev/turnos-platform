import { Ban, CalendarClock, CalendarPlus, CheckCircle2, Clock, UserX } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { EstadoCargando, EstadoError, EstadoVacio, IndicadorActualizando } from '@/components/estados';
import { Button } from '@/components/ui/button';
import { CATEGORIA_CLASES, ESTADO_TURNO_LABEL } from '@/features/agenda/linea-tiempo';
import type { MiTurno } from '@/lib/api-client';
import { fechaDeInstante, formatearFechaLarga, formatearHora, ZONA_NEGOCIO } from '@/lib/dates';
import { separarTurnos, useMisTurnosQuery } from './mis-turnos';

// El estado con icono Y texto: nunca solo color.
const ICONO_ESTADO = {
  programado: Clock,
  atendido: CheckCircle2,
  no_asistio: UserX,
  cancelado: Ban,
} as const;

export function TarjetaMiTurno({ turno }: { turno: MiTurno }) {
  const clases = CATEGORIA_CLASES[turno.servicio.categoria] ?? CATEGORIA_CLASES.ninguna;
  const IconoCategoria = clases.icono;
  const IconoEstado = ICONO_ESTADO[turno.estado];
  const cancelado = turno.estado === 'cancelado';
  // Un "programado" que ya termino no esta programado para el cliente:
  // esta pendiente de que el taller lo cierre.
  const vencido = turno.estado === 'programado' && Date.parse(turno.fin) <= Date.now();
  const categoria = turno.servicio.categoria in CATEGORIA_CLASES ? turno.servicio.categoria : null;
  return (
    <li
      className={`flex gap-3 rounded-lg border border-l-[6px] bg-card p-3 ${cancelado ? 'border-dashed' : ''}`}
      // Solo el borde izquierdo lleva el color de la categoria (las clases
      // border-categoria-* pintan los cuatro lados).
      style={categoria ? { borderLeftColor: `var(--categoria-${categoria})` } : undefined}
    >
      <IconoCategoria className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className={`text-sm font-semibold first-letter:uppercase ${cancelado ? 'line-through' : ''}`}>
          {formatearFechaLarga(fechaDeInstante(turno.inicio))} · {formatearHora(turno.inicio)}–
          {formatearHora(turno.fin)}
        </p>
        <p className="text-sm">{turno.servicio.nombre}</p>
        <p className="text-xs text-muted-foreground">
          {turno.bahia}
          {turno.tecnico ? ` · con ${turno.tecnico}` : ''}
        </p>
      </div>
      <span className="flex shrink-0 items-start gap-1 text-xs font-medium">
        <IconoEstado className="size-3.5" aria-hidden />
        {vencido ? 'Sin cerrar' : ESTADO_TURNO_LABEL[turno.estado]}
      </span>
    </li>
  );
}

/**
 * "Mis turnos" (Sprint 18): la vista del cliente. Lo que viene arriba, lo
 * que ya paso abajo (ultimos 90 dias). Horas en la zona del taller.
 */
export function MisTurnosView() {
  const navigate = useNavigate();
  const turnos = useMisTurnosQuery();

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Mis turnos</h1>
          <p className="text-sm text-muted-foreground">Horarios en hora del taller ({ZONA_NEGOCIO}).</p>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={() => navigate('/reservar')}>
            <CalendarPlus aria-hidden />
            Reservar
          </Button>
          <IndicadorActualizando activo={turnos.isFetching && !turnos.isPending} />
        </div>
      </header>

      {turnos.isPending ? (
        <EstadoCargando etiqueta="Cargando tus turnos…" />
      ) : turnos.isError ? (
        <EstadoError error={turnos.error} onReintentar={turnos.refetch} />
      ) : (
        <Listas turnos={turnos.data} onReservar={() => navigate('/reservar')} />
      )}
    </div>
  );
}

function Listas({ turnos, onReservar }: { turnos: MiTurno[]; onReservar: () => void }) {
  const { proximos, historial } = separarTurnos(turnos);
  return (
    <>
      <section aria-labelledby="proximos" className="space-y-3">
        <h2 id="proximos" className="font-heading text-lg font-semibold">
          Proximos
        </h2>
        {proximos.length === 0 ? (
          <EstadoVacio
            icono={CalendarClock}
            titulo="No tenes turnos por delante"
            descripcion="Cuando reserves uno va a aparecer aca."
            accion={<Button onClick={onReservar}>Reservar un turno</Button>}
          />
        ) : (
          <ul className="space-y-2" aria-label="Turnos proximos">
            {proximos.map((t) => (
              <TarjetaMiTurno key={t.id} turno={t} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="historial" className="space-y-3">
        <h2 id="historial" className="font-heading text-lg font-semibold">
          Historial <span className="text-sm font-normal text-muted-foreground">(ultimos 90 dias)</span>
        </h2>
        {historial.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavia no hay turnos pasados.</p>
        ) : (
          <ul className="space-y-2" aria-label="Historial de turnos">
            {historial.map((t) => (
              <TarjetaMiTurno key={t.id} turno={t} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
