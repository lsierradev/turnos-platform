import { useQuery } from '@tanstack/react-query';
import { getTecnicos } from '@/lib/api-client';

/**
 * Lista de tecnicos (solo admin: GET /usuarios?rol=tecnico da 403 a los
 * demas). La lista cambia poco, asi que se cachea un buen rato: la usan el
 * selector de /agenda y el titulo de la agenda para mostrar el nombre en
 * vez del UUID.
 */
export function useTecnicosQuery(habilitado = true) {
  return useQuery({
    queryKey: ['tecnicos'],
    queryFn: getTecnicos,
    enabled: habilitado,
    staleTime: 5 * 60_000,
  });
}
