import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchCargaDiariaMock } from './mock-data';

/**
 * Mock por ahora: no hay un endpoint de carga por bahia en el backend de
 * este sprint (solo GET /technicians/:id/agenda). El seam para conectarlo
 * despues es este mismo hook -- cambiar queryFn por una llamada real a
 * api-client.ts cuando ese endpoint exista.
 */
export function useCargaDiariaQuery(fecha: string) {
  return useQuery({
    queryKey: ['carga-diaria', fecha],
    queryFn: fetchCargaDiariaMock,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
