import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getKpis } from '@/lib/api-client';

/**
 * Intervalo de refresco, en ms.
 *
 * Sale del criterio de aceptación "desfase del panel admin < 5 s" (SRS §14).
 * El desfase que ve el admin es, en el peor caso, el TTL del caché del
 * backend MÁS este intervalo: un dato puede cambiar justo después de que se
 * llenó el caché, y encima el panel puede acabar de pedir. Con 2 s de TTL y
 * 2 s acá, el peor caso es 4 s.
 *
 * Los dos números van juntos: si se toca este, hay que tocar
 * TTL_CACHE_SEGUNDOS en reservas-service/src/modules/dashboard/dashboard.service.ts.
 *
 * Lo que hace viable este polling es justamente ese caché: sin él, cada
 * panel abierto dispararía su propia agregación sobre la tabla caliente de
 * turnos cada 2 s, en tensión directa con el criterio de p95 < 300 ms.
 */
const INTERVALO_REFRESCO_MS = 2_000;

export function useKpisQuery(from: string, to: string) {
  return useQuery({
    queryKey: ['kpis', from, to],
    queryFn: () => getKpis(from, to),
    enabled: Boolean(from && to),

    // keepPreviousData: mismo patrón que el resto de la app -- al mover el
    // rango de fechas se siguen viendo los gráficos anteriores atenuados en
    // vez de que el layout colapse a skeletons en cada cambio del filtro.
    // Con polling activo esto importa todavía más: sin él, cada refetch
    // parpadearía.
    placeholderData: keepPreviousData,

    refetchInterval: INTERVALO_REFRESCO_MS,
    // staleTime por debajo del intervalo: si fuera mayor, TanStack Query
    // serviría la copia en caché y el refetch programado no llegaría a
    // pedir nada, dejando el panel congelado.
    staleTime: 0,

    // Sin esto el polling sigue corriendo en pestañas de fondo, gastando
    // consultas para una vista que nadie está mirando. Al volver al foco,
    // TanStack Query refetchea de inmediato, así que el desfase percibido
    // sigue cumpliéndose.
    refetchIntervalInBackground: false,
  });
}
