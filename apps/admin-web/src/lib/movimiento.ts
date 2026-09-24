import { useSyncExternalStore } from 'react';

const CONSULTA = '(prefers-reduced-motion: reduce)';

function suscribir(cb: () => void) {
  const mq = window.matchMedia(CONSULTA);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

/**
 * true si el sistema pide menos movimiento. Para las animaciones que corren
 * en JavaScript (las de Recharts), que la regla de index.css no alcanza.
 */
export function usePrefiereMenosMovimiento(): boolean {
  return useSyncExternalStore(
    suscribir,
    () => window.matchMedia(CONSULTA).matches,
    () => false,
  );
}
