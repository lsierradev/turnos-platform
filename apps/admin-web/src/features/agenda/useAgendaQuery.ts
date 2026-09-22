import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getAgenda } from '@/lib/api-client';

/**
 * Conectado al endpoint real (GET /technicians/:id/agenda). El componente
 * se construyo primero contra fetchAgendaMock() (mock-data.ts, que sigue
 * en el repo como fixture de desarrollo); este es el paso "conectalo al
 * endpoint real" una vez que TechniciansModule existe en reservas-service.
 *
 * placeholderData: keepPreviousData evita el parpadeo al cambiar de fecha:
 * se sigue mostrando la agenda anterior (con la data un poco atenuada via
 * isFetching en la vista) hasta que llega la nueva, en vez de un blank o un
 * skeleton en cada refetch.
 */
export function useAgendaQuery(tecnicoId: string | undefined, fecha: string) {
  return useQuery({
    queryKey: ['agenda', tecnicoId, fecha],
    queryFn: () => getAgenda(tecnicoId as string, fecha),
    enabled: Boolean(tecnicoId),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
