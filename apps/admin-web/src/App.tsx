import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AgendaTecnicoView } from '@/features/agenda/AgendaTecnicoView';
import { PanelAdministrativoView } from '@/features/admin-panel/PanelAdministrativoView';
import { HomeView } from '@/features/home/HomeView';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomeView />} />
          <Route path="/agenda/:tecnicoId" element={<AgendaTecnicoView />} />
          <Route path="/admin" element={<PanelAdministrativoView />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
