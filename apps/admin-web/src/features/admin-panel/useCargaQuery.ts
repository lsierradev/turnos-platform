import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getCargaBahias, getTurnosBahia } from '@/lib/api-client';

/**
 * Refresco del panel, en ms. Va de la mano con TTL_CACHE_SEGUNDOS (5 s) de
 * reservas-service/src/modules/bahias/bahias.service.ts: el peor desfase
 * que ve el admin es TTL + intervalo = 20 s. Es un panel de planificacion,
 * no de monitoreo en vivo como el dashboard (2 s + 2 s): no justifica una
 * consulta agregada cada 2 s por cada panel abierto.
 */
const INTERVALO_REFRESCO_MS = 15_000;

export function useCargaQuery(desde: string, hasta: string) {
  return useQuery({
    queryKey: ['carga-bahias', desde, hasta],
    queryFn: () => getCargaBahias(desde, hasta),
    // Mismo patron que agenda y dashboard: al cambiar de fecha se siguen
    // viendo los datos anteriores atenuados en vez de saltar a skeletons.
    placeholderData: keepPreviousData,
    refetchInterval: INTERVALO_REFRESCO_MS,
    refetchIntervalInBackground: false,
    staleTime: 5_000,
  });
}

/** Turnos de una bahia en un dia: se pide solo al abrir el detalle. */
export function useTurnosBahiaQuery(bahiaId: string, fecha: string, abierto: boolean) {
  return useQuery({
    queryKey: ['turnos-bahia', bahiaId, fecha],
    queryFn: () => getTurnosBahia(bahiaId, fecha),
    enabled: abierto,
    staleTime: 15_000,
  });
}
