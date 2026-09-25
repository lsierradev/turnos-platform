import {
  Building2,
  CalendarClock,
  CalendarPlus,
  ChartColumn,
  House,
  ListChecks,
  Settings,
  UserRound,
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
export function itemsPara(
  usuario: UsuarioSesion | null,
  /** Superadmin: si ya eligio taller, ve ademas lo de un admin. */
  hayTaller = false,
): ItemNavegacion[] {
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
  const talleres: ItemNavegacion = { to: '/talleres', etiqueta: 'Talleres', icono: Building2 };
  // Sprint 21: catalogo, horario y configuracion fiscal del taller.
  const miTaller: ItemNavegacion = { to: '/taller', etiqueta: 'Mi taller', icono: Settings };
  switch (usuario?.rol) {
    // Sprint 20: el superadmin administra talleres y, dentro del que elige,
    // opera como un admin.
    case 'superadmin':
      return hayTaller
        ? [
            inicio,
            talleres,
            reservar,
            { to: '/agenda', etiqueta: 'Agenda', icono: CalendarClock },
            { to: '/admin', etiqueta: 'Panel', icono: Warehouse },
            { to: '/dashboard', etiqueta: 'Dashboard', icono: ChartColumn },
            miTaller,
          ]
        : [inicio, talleres];
    case 'admin':
      return [
        inicio,
        reservar,
        { to: '/agenda', etiqueta: 'Agenda', icono: CalendarClock },
        { to: '/admin', etiqueta: 'Panel', icono: Warehouse },
        { to: '/dashboard', etiqueta: 'Dashboard', icono: ChartColumn },
        miTaller,
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
        // Sprint 22: sus vehiculos y sus strikes (con reclamo).
        { to: '/perfil', etiqueta: 'Mi perfil', icono: UserRound },
      ];
    default:
      return [inicio];
  }
}

export const ROL_LABEL: Record<UsuarioSesion['rol'], string> = {
  admin: 'Administrador',
  tecnico: 'Tecnico',
  cliente: 'Cliente',
  superadmin: 'TurnoPro',
};
