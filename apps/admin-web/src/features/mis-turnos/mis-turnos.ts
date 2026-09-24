import { useQuery } from '@tanstack/react-query';
import { getMisTurnos, type MiTurno } from '@/lib/api-client';

export function useMisTurnosQuery() {
  return useQuery({ queryKey: ['mis-turnos'], queryFn: getMisTurnos, staleTime: 30_000 });
}

/** Proximos (los que todavia no empezaron y siguen en pie) e historial. */
export function separarTurnos(turnos: MiTurno[], ahora = Date.now()) {
  const proximos = turnos
    .filter((t) => t.estado === 'programado' && Date.parse(t.fin) > ahora)
    .sort((a, b) => a.inicio.localeCompare(b.inicio));
  const historial = turnos.filter((t) => !proximos.includes(t));
  return { proximos, historial };
}
