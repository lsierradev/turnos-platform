import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, CalendarClock, CalendarPlus, CheckCircle2, Clock, LoaderCircle, UserX } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EstadoCargando, EstadoError, EstadoVacio, IndicadorActualizando } from '@/components/estados';
import { Button, buttonVariants } from '@/components/ui/button';
import { Aviso } from '@/features/taller/comunes';
import { mensajeError } from '@/features/taller/formulario';
import { CATEGORIA_CLASES, ESTADO_TURNO_LABEL } from '@/features/agenda/linea-tiempo';
import { cancelarTurno, type MiTurno } from '@/lib/api-client';
import {
  fechaDeInstante,
  formatearFechaHora,
  formatearFechaLarga,
  formatearHora,
  ZONA_NEGOCIO,
} from '@/lib/dates';
import { formatearPesos, textoPrecioFinal } from '@/lib/dinero';
import { separarTurnos, useMisTurnosQuery } from './mis-turnos';

// El estado con icono Y texto: nunca solo color.
const ICONO_ESTADO = {
  programado: Clock,
  atendido: CheckCircle2,
  no_asistio: UserX,
  cancelado: Ban,
} as const;

export function TarjetaMiTurno({
  turno,
  onCancelado,
}: {
  turno: MiTurno;
  /** Resultado de cancelar: la tarjeta se va al historial y se remonta. */
  onCancelado?: (conStrike: boolean) => void;
}) {
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
        <p className="text-sm">
          {turno.servicio.nombre}
          {/* Sprint 21: el precio con el que se reservo (null en los viejos). */}
          {turno.precio && (
            <span className="text-muted-foreground"> · {textoPrecioFinal(turno.precio)}</span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {turno.taller ? `${turno.taller.nombre} · ` : ''}
          {turno.bahia}
          {turno.tecnico ? ` · con ${turno.tecnico}` : ''}
          {turno.vehiculo ? ` · ${turno.vehiculo.marca} ${turno.vehiculo.modelo} (${turno.vehiculo.placa})` : ''}
        </p>
        {/* Sprint 22: ciclo del turno y politica de cancelacion. */}
        <DetallesSprint22 turno={turno} onCancelado={onCancelado} />
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
  const [cancelado, setCancelado] = useState<{ conStrike: boolean } | null>(null);

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

      {cancelado && (
        <Aviso tipo={cancelado.conStrike ? 'advertencia' : 'exito'}>
          {cancelado.conStrike
            ? 'Turno cancelado. Se sumo un strike por hacerlo fuera de plazo (lo ves en Mi perfil).'
            : 'Turno cancelado sin costo.'}
        </Aviso>
      )}
      {turnos.isPending ? (
        <EstadoCargando etiqueta="Cargando tus turnos…" />
      ) : turnos.isError ? (
        <EstadoError error={turnos.error} onReintentar={turnos.refetch} />
      ) : (
        <Listas
          turnos={turnos.data}
          onReservar={() => navigate('/reservar')}
          onCancelado={(conStrike) => setCancelado({ conStrike })}
        />
      )}
    </div>
  );
}

function Listas({
  turnos,
  onReservar,
  onCancelado,
}: {
  turnos: MiTurno[];
  onReservar: () => void;
  onCancelado: (conStrike: boolean) => void;
}) {
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
              <TarjetaMiTurno key={t.id} turno={t} onCancelado={onCancelado} />
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

/** Hasta cuando es gratis, acciones y lo que dejo el turno (orden, garantia). */
function DetallesSprint22({
  turno,
  onCancelado,
}: {
  turno: MiTurno;
  onCancelado?: (conStrike: boolean) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmando, setConfirmando] = useState(false);
  const taller = turno.taller?.id;
  const cancelacion = turno.cancelacion;
  const gratis = cancelacion ? Date.parse(cancelacion.gratisHasta) >= Date.now() : false;
  const cancelar = useMutation({
    mutationFn: () => cancelarTurno(turno.id, { taller }),
    onSuccess: (r) => {
      onCancelado?.(r.strike);
      for (const clave of ['mis-turnos', 'strikes', 'politica']) {
        void queryClient.invalidateQueries({ queryKey: [clave] });
      }
    },
  });
  const orden = `/turnos/${turno.id}${taller ? `?taller=${taller}` : ''}`;

  function reprogramar() {
    const q = new URLSearchParams({
      reprogramar: turno.id,
      bahia: turno.ids.bahia,
      servicio: turno.ids.servicio,
      fecha: fechaDeInstante(turno.inicio),
    });
    if (turno.ids.tecnico) q.set('tecnico', turno.ids.tecnico);
    if (taller) q.set('taller', taller);
    navigate(`/reservar?${q.toString()}`);
  }

  return (
    <div className="space-y-1.5 pt-1">
      {turno.anticipo?.porStrikes && (
        <p className="text-xs text-advertencia-texto">
          Pago total por adelantado ({formatearPesos(turno.anticipo.centavos)}): tenes 3 strikes en este taller.
        </p>
      )}
      {turno.canceladoPor && (
        <p className="text-xs text-muted-foreground">
          {turno.canceladoPor === 'taller' ? 'Lo cancelo el taller.' : 'Lo cancelaste vos.'}
        </p>
      )}
      {turno.garantia && (
        <p className="text-xs text-muted-foreground">
          {turno.garantia.dias === null
            ? 'Garantia: la legal.'
            : `Garantia de ${turno.garantia.dias} dias${turno.garantia.hasta ? `, hasta el ${formatearFechaLarga(turno.garantia.hasta)}` : ''}.`}
        </p>
      )}
      {cancelacion && (
        <p className="text-xs">
          {gratis
            ? `Cancela o reprograma sin costo hasta el ${formatearFechaHora(cancelacion.gratisHasta)}.`
            : `Paso el plazo sin costo (${cancelacion.ventanaHoras} h antes): cancelar o reprogramar ahora suma un strike.`}
        </p>
      )}
      {cancelar.isError && <Aviso tipo="error">{mensajeError(cancelar.error, 'No se pudo cancelar el turno.')}</Aviso>}
      <div className="flex flex-wrap gap-2">
        {turno.recepcion && (
          <Link to={orden} className={buttonVariants({ variant: turno.recepcion.aceptada ? 'outline' : 'default', size: 'sm' })}>
            {turno.recepcion.aceptada ? `Ver orden N.° ${turno.recepcion.numero}` : 'Revisar y aceptar recepcion'}
          </Link>
        )}
        {cancelacion && !confirmando && (
          <>
            <Button variant="outline" size="sm" onClick={reprogramar}>
              Reprogramar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmando(true)}>
              Cancelar turno
            </Button>
          </>
        )}
        {cancelacion && confirmando && (
          <div role="group" aria-label="Confirmar cancelacion" className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium">
              {gratis ? '¿Cancelar el turno? Es sin costo.' : '¿Cancelar igual? Suma un strike.'}
            </span>
            <Button size="sm" variant="destructive" disabled={cancelar.isPending} onClick={() => cancelar.mutate()}>
              {cancelar.isPending && <LoaderCircle className="animate-spin" aria-hidden />}
              Si, cancelar
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirmando(false)}>
              No
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
