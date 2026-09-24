import {
  CalendarClock,
  CalendarPlus,
  ChartColumn,
  House,
  ListChecks,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import type { UsuarioSesion } from '@/lib/sesion';

export interface ItemNavegacion {
  to: string;
  etiqueta: string;
  icono: LucideIcon;
  /** Activo solo en la ruta exacta (para "/", que si no matchea todo). */
  exacto?: boolean;
}

/**
 * Que ve cada rol. Esto es orientacion, no seguridad: el backend rechaza
 * con 403 lo que el rol no puede ver (ver RutaProtegida). Esconder lo que
 * igual va a fallar evita mandar al usuario a una pantalla de error.
 *
 * El tecnico va directo a SU agenda: desde Sprint 9 solo puede leer la
 * propia, asi que un selector de tecnicos no le sirve.
 */
export function itemsPara(usuario: UsuarioSesion | null): ItemNavegacion[] {
  const inicio: ItemNavegacion = {
    to: '/',
    etiqueta: 'Inicio',
    icono: House,
    exacto: true,
  };
  const reservar: ItemNavegacion = {
    to: '/reservar',
    etiqueta: 'Reservar',
    icono: CalendarPlus,
  };
  switch (usuario?.rol) {
    case 'admin':
      return [
        inicio,
        reservar,
        { to: '/agenda', etiqueta: 'Agenda', icono: CalendarClock },
        { to: '/admin', etiqueta: 'Panel', icono: Warehouse },
        { to: '/dashboard', etiqueta: 'Dashboard', icono: ChartColumn },
      ];
    case 'tecnico':
      return [
        inicio,
        {
          to: `/agenda/${usuario.id}`,
          etiqueta: 'Agenda',
          icono: CalendarClock,
        },
        // Sprint 18: el mismo dashboard, limitado a sus turnos (el backend
        // fuerza el filtro por su id).
        { to: '/dashboard', etiqueta: 'Mis indicadores', icono: ChartColumn },
      ];
    // El tecnico no reserva: el turno quedaria a su nombre como cliente.
    case 'cliente':
      return [
        inicio,
        reservar,
        { to: '/mis-turnos', etiqueta: 'Mis turnos', icono: ListChecks },
      ];
    default:
      return [inicio];
  }
}

export const ROL_LABEL: Record<UsuarioSesion['rol'], string> = {
  admin: 'Administrador',
  tecnico: 'Tecnico',
  cliente: 'Cliente',
};
