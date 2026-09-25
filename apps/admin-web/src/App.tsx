import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { EstadoCargando } from '@/components/estados';
import { AppLayout } from '@/components/layout/AppLayout';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { LoginView } from '@/features/auth/LoginView';
import { RutaProtegida } from '@/features/auth/RutaProtegida';
import { HomeView } from '@/features/home/HomeView';
import { NoEncontradoView } from '@/features/home/NoEncontradoView';
import { esReintentable } from '@/lib/errores';
import { TallerProvider } from '@/lib/taller';

// Carga diferida por pantalla (Sprint 19). Antes todo iba en un solo JS de
// 992 kB (304 kB gzip): quien entraba al login descargaba Recharts entero.
// Login, inicio y el layout quedan en el paquete principal porque son lo
// primero que se ve; el resto baja al navegar.
const perezoso = <K extends string>(
  cargar: () => Promise<Record<K, React.ComponentType>>,
  nombre: K,
) => lazy(() => cargar().then((m) => ({ default: m[nombre] })));

const ReservaView = perezoso(() => import('@/features/reserva/ReservaView'), 'ReservaView');
const MisTurnosView = perezoso(() => import('@/features/mis-turnos/MisTurnosView'), 'MisTurnosView');
const SeleccionTecnicoView = perezoso(
  () => import('@/features/agenda/SeleccionTecnicoView'),
  'SeleccionTecnicoView',
);
const AgendaTecnicoView = perezoso(() => import('@/features/agenda/AgendaTecnicoView'), 'AgendaTecnicoView');
const PanelAdministrativoView = perezoso(
  () => import('@/features/admin-panel/PanelAdministrativoView'),
  'PanelAdministrativoView',
);
const DashboardView = perezoso(() => import('@/features/dashboard/DashboardView'), 'DashboardView');
const TalleresView = perezoso(() => import('@/features/talleres/TalleresView'), 'TalleresView');
const DesignView = perezoso(() => import('@/features/design/DesignView'), 'DesignView');
const OlvideView = perezoso(() => import('@/features/auth/ContrasenaViews'), 'OlvideView');
const RestablecerView = perezoso(() => import('@/features/auth/ContrasenaViews'), 'RestablecerView');
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
            {/* Taller activo (Sprint 20): necesita la sesion y el QueryClient. */}
            <TallerProvider>
            <Suspense
              fallback={
                <div className="mx-auto max-w-5xl p-4 md:p-6">
                  <EstadoCargando forma="bloque" etiqueta="Cargando pantalla…" />
                </div>
              }
            >
            <Routes>
              <Route path="/login" element={<LoginView />} />
              {/* Publicas: quien las usa todavia no puede entrar. */}
              <Route path="/olvide" element={<OlvideView />} />
              <Route path="/restablecer" element={<RestablecerView />} />

              <Route element={<RutaProtegida />}>
                <Route element={<AppLayout />}>
                  <Route path="/" element={<HomeView />} />
                  <Route path="/agenda" element={<SeleccionTecnicoView />} />
                  <Route
                    path="/agenda/:tecnicoId"
                    element={<AgendaTecnicoView />}
                  />
                  <Route path="/reservar" element={<ReservaView />} />
                  <Route path="/mis-turnos" element={<MisTurnosView />} />
                  <Route path="/talleres" element={<TalleresView />} />
                  <Route path="/admin" element={<PanelAdministrativoView />} />
                  <Route path="/dashboard" element={<DashboardView />} />
                  {/* Referencia interna del sistema de diseno (Sprint 13). */}
                  <Route path="/design" element={<DesignView />} />
                  <Route path="*" element={<NoEncontradoView />} />
                </Route>
              </Route>
            </Routes>
            </Suspense>
            </TallerProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </TemaProvider>
  );
}

export default App;
