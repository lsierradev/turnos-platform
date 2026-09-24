import { useQueries } from '@tanstack/react-query';
import { getAgenda, type TurnoAgenda } from '@/lib/api-client';
import { sumarDiasISO } from '@/lib/dates';

/**
 * Los 7 dias de la semana que arranca en `lunes`.
 *
 * Siete GET /technicians/:id/agenda?date= en paralelo en vez de un endpoint
 * de rango nuevo: el backend ya filtra cada dia por el indice GiST (son
 * requests chicos) y, sobre todo, usan la MISMA queryKey que la vista de
 * dia. Pasar de semana a dia (o volver) no vuelve a pedir nada que ya este
 * en cache.
 */
export function useAgendaSemanaQuery(tecnicoId: string | undefined, lunes: string) {
  const dias = Array.from({ length: 7 }, (_, i) => sumarDiasISO(lunes, i));
  return useQueries({
    queries: dias.map((fecha) => ({
      queryKey: ['agenda', tecnicoId, fecha],
      queryFn: () => getAgenda(tecnicoId as string, fecha),
      enabled: Boolean(tecnicoId),
      staleTime: 30_000,
    })),
    combine: (resultados) => ({
      dias: dias.map((fecha, i) => ({
        fecha,
        turnos: (resultados[i].data ?? []) as TurnoAgenda[],
      })),
      isPending: resultados.some((r) => r.isPending),
      isFetching: resultados.some((r) => r.isFetching),
      // El primer error alcanza para mostrar el estado de error; reintentar
      // vuelve a pedir solo los dias que fallaron.
      error: resultados.find((r) => r.error)?.error ?? null,
      reintentar: () =>
        Promise.all(resultados.filter((r) => r.isError).map((r) => r.refetch())),
    }),
  });
}
