import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserX } from 'lucide-react';
import { useState } from 'react';
import { EstadoError } from '@/components/estados';
import { Button } from '@/components/ui/button';
import {
  getTecnicosReservables,
  getTurnosSinTecnico,
  reasignarTecnico,
  type TurnoSinTecnico,
} from '@/lib/api-client';
import { fechaDeInstante, formatearDiaCorto, formatearHora } from '@/lib/dates';

/**
 * Turnos que vienen sin tecnico porque el suyo se dio de baja (Sprint 21).
 * No se reasignan solos: el admin elige quien los toma. Si no hay ninguno,
 * no ocupa lugar.
 */
export function TurnosSinTecnico() {
  const turnos = useQuery({ queryKey: ['turnos-sin-tecnico'], queryFn: getTurnosSinTecnico });
  const tecnicos = useQuery({ queryKey: ['tecnicos-reservables'], queryFn: getTecnicosReservables });

  if (!turnos.data || turnos.data.length === 0) return null;

  return (
    <section
      aria-labelledby="sin-tecnico-titulo"
      className="space-y-3 rounded-lg border border-advertencia/40 bg-advertencia-suave p-4"
    >
      <div className="flex gap-3">
        <UserX className="mt-0.5 size-5 shrink-0 text-advertencia" aria-hidden />
        <div className="text-sm">
          <h2 id="sin-tecnico-titulo" className="font-semibold text-advertencia-texto">
            {turnos.data.length === 1
              ? '1 turno sin tecnico'
              : `${turnos.data.length} turnos sin tecnico`}
          </h2>
          <p className="text-foreground">
            Su tecnico se dio de baja. Asigna a otro para que no queden sin atender.
          </p>
        </div>
      </div>
      <ul className="space-y-2">
        {turnos.data.map((t) => (
          <FilaSinTecnico key={t.id} turno={t} tecnicos={tecnicos.data ?? []} />
        ))}
      </ul>
    </section>
  );
}

function FilaSinTecnico({
  turno,
  tecnicos,
}: {
  turno: TurnoSinTecnico;
  tecnicos: { id: string; nombre: string }[];
}) {
  const queryClient = useQueryClient();
  const [tecnicoId, setTecnicoId] = useState('');
  const asignar = useMutation({
    mutationFn: () => reasignarTecnico(turno.id, tecnicoId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['turnos-sin-tecnico'] });
      void queryClient.invalidateQueries({ queryKey: ['carga-bahias'] });
    },
  });
  const cuando = `${formatearDiaCorto(fechaDeInstante(turno.inicio))} ${formatearHora(turno.inicio)}`;
  const idSelect = `reasignar-${turno.id}`;

  return (
    <li className="space-y-2 rounded-md border bg-card p-3 text-sm sm:flex sm:items-center sm:gap-3 sm:space-y-0">
      <p className="flex-1">
        <span className="font-medium first-letter:uppercase">{cuando}</span> · {turno.servicio} ·{' '}
        {turno.bahia}
        {turno.cliente ? ` · ${turno.cliente}` : ''}
      </p>
      <div className="flex gap-2">
        <label htmlFor={idSelect} className="sr-only">
          Tecnico para el turno de {cuando}
        </label>
        <select
          id={idSelect}
          value={tecnicoId}
          onChange={(e) => setTecnicoId(e.target.value)}
          className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-card px-2 text-sm dark:bg-input/30"
        >
          <option value="">Elegir tecnico…</option>
          {tecnicos.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nombre}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          disabled={!tecnicoId || asignar.isPending}
          onClick={() => asignar.mutate()}
        >
          {asignar.isPending ? 'Asignando…' : 'Asignar'}
        </Button>
      </div>
      {asignar.isError && (
        <div className="sm:basis-full">
          <EstadoError error={asignar.error} />
        </div>
      )}
    </li>
  );
}
