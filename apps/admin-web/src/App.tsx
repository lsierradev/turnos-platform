import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PanelAdministrativoView } from '@/features/admin-panel/PanelAdministrativoView';
import { AgendaTecnicoView } from '@/features/agenda/AgendaTecnicoView';
import { SeleccionTecnicoView } from '@/features/agenda/SeleccionTecnicoView';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { LoginView } from '@/features/auth/LoginView';
import { RutaProtegida } from '@/features/auth/RutaProtegida';
import { DashboardView } from '@/features/dashboard/DashboardView';
import { DesignView } from '@/features/design/DesignView';
import { HomeView } from '@/features/home/HomeView';
import { NoEncontradoView } from '@/features/home/NoEncontradoView';
import { esReintentable } from '@/lib/errores';
import { TemaProvider } from '@/lib/tema';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // No reintentar lo que va a fallar igual: 401 (ya lo maneja el
      // cliente HTTP renovando el token), 403 (no tiene el rol), 400 y 404
      // (el dato no cambia por insistir). Reintentarlos solo agrega latencia
      // antes de mostrar el error. Misma regla que decide si el estado de
      // error ofrece "Reintentar" (lib/errores.ts).
      retry: (intentos, error) => esReintentable(error) && intentos < 1,
    },
  },
});

export function App() {
  return (
    <TemaProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          {/* AuthProvider adentro del router: LoginView navega al entrar. */}
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginView />} />

              <Route element={<RutaProtegida />}>
                <Route element={<AppLayout />}>
                  <Route path="/" element={<HomeView />} />
                  <Route path="/agenda" element={<SeleccionTecnicoView />} />
                  <Route
                    path="/agenda/:tecnicoId"
                    element={<AgendaTecnicoView />}
                  />
                  <Route path="/admin" element={<PanelAdministrativoView />} />
                  <Route path="/dashboard" element={<DashboardView />} />
                  {/* Referencia interna del sistema de diseno (Sprint 13). */}
                  <Route path="/design" element={<DesignView />} />
                  <Route path="*" element={<NoEncontradoView />} />
                </Route>
              </Route>
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </TemaProvider>
  );
}

export default App;
