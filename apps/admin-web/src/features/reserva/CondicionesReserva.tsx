import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { TextoLegal } from '@/components/TextoLegal';
import { getEstadoCondiciones, type DocumentoLegal } from '@/lib/api-client';
import { useTaller } from '@/lib/taller';

/**
 * Condiciones del taller que el titular del turno tiene que aceptar antes
 * de reservar (Sprint 23). null: no hay nada que aceptar (el taller no
 * publico condiciones, o el titular ya acepto la version vigente).
 *
 * - Cliente: las propias.
 * - Admin con un cliente existente: las de ese cliente.
 * - Admin con un cliente nuevo: todavia no tiene cuenta, asi que tiene que
 *   aceptar la vigente seguro.
 *
 * Reprogramar no las pide: sigue el acuerdo con el que se tomo el turno.
 */
export function useCondicionesPorAceptar(opciones: {
  activo: boolean;
  esAdmin: boolean;
  clienteId: string | undefined;
  clienteNuevo: boolean;
}) {
  const { activo, esAdmin, clienteId, clienteNuevo } = opciones;
  // El taller en la clave: el cliente cambia de taller sin recargar, y las
  // condiciones (y si las acepto) son de cada uno.
  const { tallerId } = useTaller();
  const consulta = useQuery({
    queryKey: ['condiciones', 'estado', tallerId, esAdmin ? (clienteNuevo ? 'nuevo' : clienteId) : 'propias'],
    queryFn: () => getEstadoCondiciones(esAdmin && !clienteNuevo ? clienteId : undefined),
    enabled: activo && (!esAdmin || clienteNuevo || Boolean(clienteId)),
  });
  const vigente = consulta.data?.vigente ?? null;
  const aceptada = !esAdmin || !clienteNuevo ? (consulta.data?.aceptada ?? true) : false;
  return {
    porAceptar: activo && vigente && !aceptada ? vigente : null,
    refetch: consulta.refetch,
  };
}

export function CondicionesReserva({
  condiciones,
  esAdmin,
  aceptadas,
  onAceptadas,
  mostrarError,
}: {
  condiciones: DocumentoLegal;
  esAdmin: boolean;
  aceptadas: boolean;
  onAceptadas: (valor: boolean) => void;
  mostrarError: boolean;
}) {
  const enlace = `/legal/talleres/${condiciones.tallerId}/condiciones?version=${condiciones.version}`;
  return (
    <div className="space-y-2 rounded-lg border p-3 text-sm">
      <details>
        <summary className="flex cursor-pointer items-center gap-2 font-medium">
          <FileText className="size-4 text-muted-foreground" aria-hidden />
          Condiciones del servicio del taller (versión {condiciones.version})
        </summary>
        <div
          className="mt-3 max-h-72 overflow-y-auto rounded-lg border bg-muted/30 p-3"
          tabIndex={0}
          role="region"
          aria-label="Condiciones del servicio del taller"
        >
          <TextoLegal contenido={condiciones.contenido} bajarTitulos />
        </div>
      </details>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-primary"
          checked={aceptadas}
          onChange={(e) => onAceptadas(e.target.checked)}
          aria-invalid={mostrarError && !aceptadas}
          aria-describedby={mostrarError && !aceptadas ? 'condiciones-error' : undefined}
        />
        <span>
          {esAdmin
            ? 'El cliente leyó y aceptó en el mostrador las '
            : 'Leí y acepto las '}
          <a
            href={enlace}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-marca-texto underline-offset-4 hover:underline"
          >
            condiciones del servicio
          </a>{' '}
          (precios, anticipo, cancelación, strikes y garantía).
        </span>
      </label>
      {mostrarError && !aceptadas && (
        <p id="condiciones-error" className="text-xs text-destructive">
          Para reservar hay que aceptar las condiciones del taller.
        </p>
      )}
    </div>
  );
}
