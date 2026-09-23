import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  login as loginApi,
  logout as logoutApi,
  obtenerTokens,
  registrarCierreDeSesion,
} from '@/lib/api-client';
import { usuarioDeToken, type UsuarioSesion } from '@/lib/sesion';

interface EstadoAuth {
  usuario: UsuarioSesion | null;
  autenticado: boolean;
  iniciarSesion: (email: string, password: string) => Promise<void>;
  cerrarSesion: () => void;
}

const AuthContext = createContext<EstadoAuth | null>(null);

function usuarioActual(): UsuarioSesion | null {
  const tokens = obtenerTokens();
  return tokens ? usuarioDeToken(tokens.accessToken) : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // El estado inicial se lee de forma síncrona de los tokens que ya había en
  // sessionStorage. Si esto arrancara en null y se resolviera en un efecto,
  // al recargar la página se vería un parpadeo hacia el login antes de
  // volver a la vista, aunque la sesión siguiera siendo válida.
  const [usuario, setUsuario] = useState<UsuarioSesion | null>(usuarioActual);

  const cerrarSesion = useCallback(() => {
    logoutApi();
    setUsuario(null);
  }, []);

  useEffect(() => {
    // El cliente HTTP avisa cuando la sesión se perdió sola (el refresh
    // token venció, o el backend rechazó el access token aun después de
    // renovarlo). Sin esto, la interfaz seguiría mostrando al usuario como
    // logueado mientras todas las llamadas fallan con 401.
    registrarCierreDeSesion(() => setUsuario(null));
    return () => registrarCierreDeSesion(null);
  }, []);

  const iniciarSesion = useCallback(
    async (email: string, password: string) => {
      const tokens = await loginApi(email, password);
      setUsuario(usuarioDeToken(tokens.accessToken));
    },
    [],
  );

  const valor = useMemo<EstadoAuth>(
    () => ({
      usuario,
      autenticado: usuario !== null,
      iniciarSesion,
      cerrarSesion,
    }),
    [usuario, iniciarSesion, cerrarSesion],
  );

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>;
}

export function useAuth(): EstadoAuth {
  const contexto = useContext(AuthContext);
  if (!contexto) {
    throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  }
  return contexto;
}
