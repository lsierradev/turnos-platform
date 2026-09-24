import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type PreferenciaTema = 'claro' | 'oscuro' | 'sistema';

// Misma clave y misma logica que el script inline de index.html, que
// aplica el tema ANTES del primer pintado. Si se cambia una, cambiar la
// otra: si no, la pagina carga con un tema y salta al otro al montar React.
const CLAVE = 'turnos-tema';

function leerPreferencia(): PreferenciaTema {
  try {
    const guardada = localStorage.getItem(CLAVE);
    if (guardada === 'claro' || guardada === 'oscuro') return guardada;
  } catch {
    // Almacenamiento bloqueado (modo privado estricto): cae a sistema.
  }
  return 'sistema';
}

const consultaOscuro = () => window.matchMedia('(prefers-color-scheme: dark)');

function aplicar(preferencia: PreferenciaTema) {
  const oscuro =
    preferencia === 'oscuro' ||
    (preferencia === 'sistema' && consultaOscuro().matches);
  document.documentElement.classList.toggle('dark', oscuro);
}

interface ContextoTema {
  preferencia: PreferenciaTema;
  setPreferencia: (p: PreferenciaTema) => void;
}

const Contexto = createContext<ContextoTema | null>(null);

export function TemaProvider({ children }: { children: ReactNode }) {
  const [preferencia, setEstado] = useState(leerPreferencia);

  const setPreferencia = useCallback((p: PreferenciaTema) => {
    setEstado(p);
    try {
      if (p === 'sistema') localStorage.removeItem(CLAVE);
      else localStorage.setItem(CLAVE, p);
    } catch {
      // Sin almacenamiento el tema dura lo que la pestana.
    }
  }, []);

  useEffect(() => {
    aplicar(preferencia);
    if (preferencia !== 'sistema') return;
    // En "sistema" se sigue al SO en vivo: una pantalla del taller que
    // pasa a modo noche no deberia necesitar recargar el panel.
    const consulta = consultaOscuro();
    const alCambiar = () => aplicar('sistema');
    consulta.addEventListener('change', alCambiar);
    return () => consulta.removeEventListener('change', alCambiar);
  }, [preferencia]);

  const valor = useMemo(
    () => ({ preferencia, setPreferencia }),
    [preferencia, setPreferencia],
  );
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTema(): ContextoTema {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error('useTema() fuera de <TemaProvider>');
  return ctx;
}
