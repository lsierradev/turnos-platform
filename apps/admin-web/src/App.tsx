import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Outlet, Route, Routes } from 'react-router-dom';
import { AppHeader } from '@/components/AppHeader';
import { PanelAdministrativoView } from '@/features/admin-panel/PanelAdministrativoView';
import { AgendaTecnicoView } from '@/features/agenda/AgendaTecnicoView';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { LoginView } from '@/features/auth/LoginView';
import { RutaProtegida } from '@/features/auth/RutaProtegida';
import { DashboardView } from '@/features/dashboard/DashboardView';
import { HomeView } from '@/features/home/HomeView';
import { ApiError } from '@/lib/api-client';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // No reintentar un 401 ni un 403: el primero ya lo maneja el cliente
      // HTTP renovando el token, y el segundo no va a cambiar por insistir
      // —el usuario no tiene el rol—. Reintentarlos solo agrega latencia
      // antes de mostrar el error.
      retry: (intentos, error) => {
        if (error instanceof ApiError && [401, 403].includes(error.status)) {
          return false;
        }
        return intentos < 1;
      },
    },
  },
});

function LayoutPrivado() {
  return (
    <>
      <AppHeader />
      <Outlet />
    </>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {/* AuthProvider adentro del router: LoginView navega al entrar. */}
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginView />} />

            <Route element={<RutaProtegida />}>
              <Route element={<LayoutPrivado />}>
                <Route path="/" element={<HomeView />} />
                <Route
                  path="/agenda/:tecnicoId"
                  element={<AgendaTecnicoView />}
                />
                <Route path="/admin" element={<PanelAdministrativoView />} />
                <Route path="/dashboard" element={<DashboardView />} />
              </Route>
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
