import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';

/**
 * Envuelve las rutas que exigen sesion.
 *
 * Guarda en el state de la navegacion la ruta que el usuario queria abrir,
 * para que LoginView pueda devolverlo ahi despues de entrar en vez de
 * mandarlo siempre al inicio.
 *
 * Esto NO es control de acceso: solo evita mostrar pantallas que van a
 * fallar. Quien decide de verdad es el backend, que valida el token y el rol
 * en cada request (RolesGuard). Un usuario que edite su token para decir que
 * es admin solo lograria ver un menu con opciones que el servidor le va a
 * rechazar con 403.
 */
export function RutaProtegida() {
  const { autenticado } = useAuth();
  const location = useLocation();

  if (!autenticado) {
    return (
      <Navigate to="/login" replace state={{ desde: location.pathname }} />
    );
  }

  return <Outlet />;
}
