import type { TurnoAgenda } from '@/lib/api-client';

// Fixtures de desarrollo. Usadas mientras se construian los componentes
// (antes de conectarlos al endpoint real) y para dev sin backend levantado.
// useAgendaQuery ya no las usa por default -- ver mockAgendaFetcher() abajo
// si se necesita volver a apuntar a mocks.
export const AGENDA_MOCK: TurnoAgenda[] = [
  {
    id: 'mock-1',
    bahiaId: 'bahia-1',
    servicioId: 'servicio-1',
    tecnicoId: 'mock-tecnico',
    usuarioId: 'usuario-1',
    estado: 'programado',
    rangoTiempo: {
      inicio: '2024-01-08T09:00:00.000Z',
      fin: '2024-01-08T09:30:00.000Z',
    },
    bahia: { id: 'bahia-1', nombre: 'Bahia 1' },
    servicio: {
      id: 'servicio-1',
      nombre: 'Cambio de aceite',
      categoria: 'mecanica',
      duracionMinutos: 30,
    },
  },
  {
    id: 'mock-2',
    bahiaId: 'bahia-2',
    servicioId: 'servicio-2',
    tecnicoId: 'mock-tecnico',
    usuarioId: 'usuario-2',
    estado: 'programado',
    rangoTiempo: {
      inicio: '2024-01-08T11:00:00.000Z',
      fin: '2024-01-08T12:00:00.000Z',
    },
    bahia: { id: 'bahia-2', nombre: 'Bahia 2' },
    servicio: {
      id: 'servicio-2',
      nombre: 'Alineacion y balanceo',
      categoria: 'mecanica',
      duracionMinutos: 60,
    },
  },
  {
    id: 'mock-3',
    bahiaId: 'bahia-1',
    servicioId: 'servicio-3',
    tecnicoId: 'mock-tecnico',
    usuarioId: 'usuario-3',
    estado: 'programado',
    rangoTiempo: {
      inicio: '2024-01-08T15:00:00.000Z',
      fin: '2024-01-08T16:00:00.000Z',
    },
    bahia: { id: 'bahia-1', nombre: 'Bahia 1' },
    servicio: {
      id: 'servicio-3',
      nombre: 'Reparacion electrica',
      categoria: 'electrica',
      duracionMinutos: 60,
    },
  },
];

export function fetchAgendaMock(): Promise<TurnoAgenda[]> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(AGENDA_MOCK), 400);
  });
}
