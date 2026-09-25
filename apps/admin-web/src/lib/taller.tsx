import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  establecerTallerElegido,
  getTalleres,
  obtenerTallerElegido,
  type Taller,
} from './api-client';

interface EstadoTaller {
  /** El taller en el que se opera, o null si falta elegirlo. */
  tallerId: string | null;
  taller: Taller | null;
  talleres: Taller[];
  cargando: boolean;
  /** Admin y tecnico no eligen: su taller es el del token. */
  puedeElegir: boolean;
  elegir: (id: string) => void;
}

const TallerContext = createContext<EstadoTaller | null>(null);

/**
 * Taller activo (Sprint 20).
 *
 * - admin y tecnico: el de su token, fijo.
 * - cliente y superadmin: el que eligen; va en el encabezado X-Taller.
 *
 * Cambiar de taller borra la cache de TanStack Query (salvo la lista de
 * talleres): sin eso, durante un instante se verian bahias o turnos del
 * taller anterior con el nombre del nuevo.
 */
export function TallerProvider({ children }: { children: ReactNode }) {
  const { usuario } = useAuth();
  const queryClient = useQueryClient();
  const puedeElegir = usuario?.rol === 'cliente' || usuario?.rol === 'superadmin';
  const [elegido, setElegido] = useState<string | null>(() =>
    puedeElegir ? obtenerTallerElegido() : null,
  );

  const talleres = useQuery({
    queryKey: ['talleres'],
    queryFn: getTalleres,
    enabled: usuario !== null,
    staleTime: 5 * 60_000,
  });

  const elegir = useCallback(
    (id: string) => {
      establecerTallerElegido(id);
      setElegido(id);
      // Lo cargado es de otro taller (o de ninguno): se descarta. Con
      // cancel + reset y NO removeQueries: remover una consulta con una
      // pantalla montada la deja colgada de una consulta que ya no existe, y
      // la respuesta en vuelo nunca le llega (Sprint 21: "Mis turnos" del
      // cliente quedaba cargando para siempre cuando el taller se elegia
      // solo). reset vuelve a pedir las activas, ya con el X-Taller nuevo.
      const deOtroTaller = { predicate: (q: { queryKey: readonly unknown[] }) => q.queryKey[0] !== 'talleres' };
      void queryClient
        .cancelQueries(deOtroTaller)
        .then(() => queryClient.resetQueries(deOtroTaller));
    },
    [queryClient],
  );

  const lista = useMemo(() => talleres.data ?? [], [talleres.data]);
  const tallerId = puedeElegir ? elegido : (usuario?.taller ?? null);

  // Un cliente con un solo taller disponible no tiene nada que elegir. Un
  // elegido que ya no esta en la lista (dado de baja) se descarta.
  useEffect(() => {
    if (!puedeElegir || !talleres.data) return;
    const activos = talleres.data.filter((t) => t.activo);
    if (elegido && !talleres.data.some((t) => t.id === elegido)) {
      establecerTallerElegido(null);
      setElegido(null);
    } else if (!elegido && usuario?.rol === 'cliente' && activos.length === 1) {
      elegir(activos[0].id);
    }
  }, [puedeElegir, talleres.data, elegido, usuario?.rol, elegir]);

  const valor = useMemo<EstadoTaller>(
    () => ({
      tallerId,
      taller: lista.find((t) => t.id === tallerId) ?? null,
      talleres: lista,
      cargando: talleres.isPending,
      puedeElegir,
      elegir,
    }),
    [tallerId, lista, talleres.isPending, puedeElegir, elegir],
  );

  return <TallerContext.Provider value={valor}>{children}</TallerContext.Provider>;
}

export function useTaller(): EstadoTaller {
  const contexto = useContext(TallerContext);
  if (!contexto) throw new Error('useTaller debe usarse dentro de <TallerProvider>');
  return contexto;
}
