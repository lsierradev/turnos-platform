import { useEffect } from 'react';

const SUFIJO = 'TurnosPro';

/**
 * Titulo de la pestana (WCAG 2.4.2). Hasta Sprint 19 era el mismo en todas
 * las pantallas ("turnos-platform admin"): con varias pestanas abiertas no
 * se distinguian, y un lector de pantalla no anunciaba a donde se llego.
 */
export function useTituloPagina(titulo: string): void {
  useEffect(() => {
    document.title = `${titulo} · ${SUFIJO}`;
  }, [titulo]);
}

/** Titulo segun la ruta del panel autenticado. */
export function tituloDeRuta(pathname: string, rol?: string): string {
  if (pathname === '/') return 'Inicio';
  if (pathname === '/reservar') return 'Reservar turno';
  if (pathname === '/mis-turnos') return 'Mis turnos';
  if (pathname === '/agenda') return 'Agenda';
  if (pathname.startsWith('/agenda/')) return rol === 'tecnico' ? 'Mi agenda' : 'Agenda del tecnico';
  if (pathname === '/admin') return 'Panel del taller';
  if (pathname === '/dashboard') return rol === 'admin' || rol === 'superadmin' ? 'Dashboard' : 'Mis indicadores';
  if (pathname === '/design') return 'Sistema de diseno';
  if (pathname === '/talleres') return 'Talleres';
  return 'Pagina no encontrada';
}
