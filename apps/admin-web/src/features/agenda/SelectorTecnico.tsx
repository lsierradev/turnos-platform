import { useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { ChevronsUpDown } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { EstadoCargando, EstadoError } from '@/components/estados';
import { buttonVariants } from '@/components/ui/button';
import { BuscadorTecnicos } from './BuscadorTecnicos';
import { useTecnicosQuery } from './useTecnicosQuery';

/**
 * Cambiar de tecnico sin salir de la agenda (solo admin). Conserva la
 * vista y la fecha: si el admin estaba mirando el martes en semana, va al
 * martes en semana del otro tecnico.
 */
export function SelectorTecnico({
  tecnicoId,
  nombreActual,
}: {
  tecnicoId: string;
  nombreActual?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const tecnicos = useTecnicosQuery();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  return (
    <Popover.Root open={abierto} onOpenChange={setAbierto}>
      <Popover.Trigger
        className={`${buttonVariants({ variant: 'outline' })} max-w-full justify-between gap-2`}
        aria-label={`Tecnico: ${nombreActual ?? 'sin elegir'}. Cambiar de tecnico`}
      >
        <span className="truncate">{nombreActual ?? 'Elegir tecnico'}</span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start" className="z-50">
          <Popover.Popup className="w-[min(22rem,calc(100vw-2rem))] rounded-xl bg-popover p-3 text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none">
            <Popover.Title className="sr-only">Cambiar de tecnico</Popover.Title>
            {tecnicos.isPending ? (
              <EstadoCargando etiqueta="Cargando tecnicos…" />
            ) : tecnicos.isError ? (
              <EstadoError error={tecnicos.error} onReintentar={tecnicos.refetch} />
            ) : (
              <BuscadorTecnicos
                tecnicos={tecnicos.data}
                seleccionadoId={tecnicoId}
                autoFocus
                alto="max-h-72"
                onElegir={(t) => {
                  setAbierto(false);
                  navigate({ pathname: `/agenda/${t.id}`, search: params.toString() });
                }}
              />
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
