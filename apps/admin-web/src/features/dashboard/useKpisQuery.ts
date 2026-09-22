import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getKpis } from '@/lib/api-client';

/**
 * KPIs del dashboard (RF-04), conectado a GET /dashboard/kpis.
 *
 * `staleTime` de 60s, mas alto que los 30s de useAgendaQuery: la agenda es
 * operativa (un turno nuevo tiene que aparecer ya), los KPIs son de lectura
 * y cada refetch dispara una agregacion sobre la tabla caliente de turnos.
 * Refrescar esto cada 30s no le aporta nada al admin y si le cuesta al
 * motor de reservas.
 *
 * keepPreviousData: mismo patron que el resto de la app -- al mover el
 * rango de fechas se siguen viendo los graficos anteriores atenuados en vez
 * de que el layout colapse a skeletons en cada cambio del filtro.
 */
export function useKpisQuery(from: string, to: string) {
  return useQuery({
    queryKey: ['kpis', from, to],
    queryFn: () => getKpis(from, to),
    enabled: Boolean(from && to),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}
