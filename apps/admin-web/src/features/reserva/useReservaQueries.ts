import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect } from 'react';
import {
  getBahias,
  getClientes,
  getDisponibilidad,
  getPolitica,
  getServicios,
  getTecnicosReservables,
  getVehiculos,
  type DisponibilidadParams,
} from '@/lib/api-client';
import { sumarDiasISO } from '@/lib/dates';

// Los tres catalogos cambian poco (altas de bahias o servicios): se piden
// en paralelo apenas se abre la pantalla, no uno detras de otro a medida
// que se eligen (UX-NOTES punto 10). Asi elegir bahia -> servicio ->
// tecnico nunca espera la red.
const CATALOGO_STALE_MS = 5 * 60_000;

export function useBahiasQuery() {
  return useQuery({
    queryKey: ['reserva', 'bahias'],
    queryFn: getBahias,
    staleTime: CATALOGO_STALE_MS,
  });
}

export function useServiciosQuery() {
  return useQuery({
    queryKey: ['reserva', 'servicios'],
    queryFn: getServicios,
    staleTime: CATALOGO_STALE_MS,
    // GET /servicios devuelve tambien los dados de baja; el POST ya los
    // rechaza, asi que ni se ofrecen.
    select: (servicios) => servicios.filter((s) => s.activo),
  });
}

export function useTecnicosReservablesQuery() {
  return useQuery({
    queryKey: ['reserva', 'tecnicos'],
    queryFn: getTecnicosReservables,
    staleTime: CATALOGO_STALE_MS,
  });
}

/** Clientes para reservar a su nombre: GET /usuarios es solo admin. */
export function useClientesQuery(habilitado: boolean) {
  return useQuery({
    queryKey: ['clientes'],
    queryFn: getClientes,
    enabled: habilitado,
    staleTime: 60_000,
  });
}

function claveDisponibilidad(p: DisponibilidadParams) {
  return ['disponibilidad', p.bahiaId, p.servicioId, p.tecnicoId, p.fecha, p.clienteId ?? ''];
}

/**
 * Horarios libres del dia. Sin staleTime: es lo que se mira justo antes de
 * reservar, y un dato viejo es justo el que despues da 409.
 *
 * keepPreviousData, como la agenda y el panel: al cambiar de dia o de
 * tecnico la grilla anterior queda atenuada en vez de saltar a un
 * skeleton. La vista deshabilita esos botones mientras isPlaceholderData,
 * para no dejar elegir un horario de la combinacion anterior.
 *
 * Ademas precarga el dia siguiente (UX-NOTES punto 9): si el dia elegido
 * esta lleno, "Siguiente" ya tiene los datos.
 */
export function useDisponibilidadQuery(params: DisponibilidadParams | null) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: params ? claveDisponibilidad(params) : ['disponibilidad', 'nada'],
    queryFn: () => getDisponibilidad(params!),
    enabled: params !== null,
    placeholderData: keepPreviousData,
  });

  const exito = query.isSuccess && !query.isPlaceholderData;
  useEffect(() => {
    if (!params || !exito) return;
    const siguiente = { ...params, fecha: sumarDiasISO(params.fecha, 1) };
    void queryClient.prefetchQuery({
      queryKey: claveDisponibilidad(siguiente),
      queryFn: () => getDisponibilidad(siguiente),
      staleTime: 30_000,
    });
  }, [queryClient, exito, params?.bahiaId, params?.servicioId, params?.tecnicoId, params?.fecha, params?.clienteId]); // eslint-disable-line react-hooks/exhaustive-deps

  return query;
}

/**
 * Sprint 22: vehiculos del titular (el cliente, los suyos; el admin, los
 * del cliente elegido) y como esta en la politica de cancelacion del
 * taller (3 strikes: pago total por adelantado).
 */
export function useVehiculosTitularQuery(habilitado: boolean, clienteId?: string) {
  return useQuery({
    queryKey: ['vehiculos', clienteId ?? 'mios'],
    queryFn: () => getVehiculos(clienteId),
    enabled: habilitado,
    staleTime: 60_000,
  });
}

export function usePoliticaQuery(habilitado: boolean, clienteId?: string) {
  return useQuery({
    queryKey: ['politica', clienteId ?? 'mia'],
    queryFn: () => getPolitica(clienteId),
    enabled: habilitado,
    staleTime: 30_000,
  });
}
