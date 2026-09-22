import type { CargaBahia } from './types';

// No existe (ni fue pedido) un endpoint de carga por bahia todavia -- ver
// docs/ENDPOINTS.txt de reservas-service. Esta vista queda en mock hasta
// que se agregue uno; la UI lo deja explicito (ver PanelAdministrativoView).
const MINUTOS_JORNADA = 10 * 60; // 08:00-18:00, mismo horario laboral que el backend

const CARGA_MOCK: CargaBahia[] = [
  {
    bahiaId: 'bahia-1',
    nombreBahia: 'Bahia 1',
    cantidadTurnos: 5,
    minutosOcupados: 240,
    minutosJornada: MINUTOS_JORNADA,
  },
  {
    bahiaId: 'bahia-2',
    nombreBahia: 'Bahia 2',
    cantidadTurnos: 3,
    minutosOcupados: 150,
    minutosJornada: MINUTOS_JORNADA,
  },
  {
    bahiaId: 'bahia-3',
    nombreBahia: 'Bahia 3',
    cantidadTurnos: 8,
    minutosOcupados: 540,
    minutosJornada: MINUTOS_JORNADA,
  },
];

export function fetchCargaDiariaMock(): Promise<CargaBahia[]> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(CARGA_MOCK), 400);
  });
}
