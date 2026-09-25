export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export interface UsuarioSesion {
  id: string;
  email: string;
  rol: 'admin' | 'tecnico' | 'cliente' | 'superadmin';
  /**
   * Taller del personal (admin, tecnico), Sprint 20. null para el cliente y
   * el superadmin: ellos eligen taller (ver lib/taller.tsx).
   */
  taller: string | null;
}

const CLAVE = 'turnos.sesion';

/*
 * sessionStorage y NO localStorage, a propósito.
 *
 * El panel se usa en computadoras compartidas del taller. Con
 * sessionStorage, cerrar la pestaña cierra la sesión; con localStorage, el
 * próximo que se siente en esa máquina entra como el anterior. Es la
 * diferencia que importa en este contexto.
 *
 * El límite conocido: cualquier almacenamiento accesible por JavaScript es
 * legible por un XSS. La alternativa robusta es una cookie httpOnly, pero
 * eso exige que el backend maneje cookies y protección CSRF, que es un
 * cambio de diseño mayor. Para un beta cerrado con usuarios conocidos, este
 * es el compromiso; está anotado en docs/GO-LIVE.md.
 *
 * Todos los accesos van envueltos en try/catch: en modo privado o con el
 * almacenamiento bloqueado, `sessionStorage` puede lanzar en vez de devolver
 * null, y eso tiraría la aplicación entera al arrancar.
 */

export function leerSesion(): Tokens | null {
  try {
    const crudo = sessionStorage.getItem(CLAVE);
    if (!crudo) {
      return null;
    }
    const datos = JSON.parse(crudo) as Partial<Tokens>;
    return datos.accessToken && datos.refreshToken
      ? { accessToken: datos.accessToken, refreshToken: datos.refreshToken }
      : null;
  } catch {
    return null;
  }
}

export function guardarSesion(tokens: Tokens): void {
  try {
    sessionStorage.setItem(CLAVE, JSON.stringify(tokens));
  } catch {
    // Sin persistencia la sesión sigue viva en memoria hasta recargar. Es
    // peor experiencia, no un error que valga la pena mostrar.
  }
}

export function limpiarSesion(): void {
  try {
    sessionStorage.removeItem(CLAVE);
  } catch {
    /* mismo caso que guardarSesion */
  }
}

/**
 * Lee el payload del JWT para saber quién está logueado y con qué rol.
 *
 * Esto es SOLO para decidir qué mostrar en la interfaz. La autorización de
 * verdad la hace el backend en cada request: un usuario puede editar su
 * propio token y cambiarse el rol acá, y lo único que lograría es ver
 * botones que el servidor le va a rechazar con 403.
 */
export function usuarioDeToken(accessToken: string): UsuarioSesion | null {
  try {
    const payload = accessToken.split('.')[1];
    if (!payload) {
      return null;
    }
    // base64url -> base64, y se repone el padding que el JWT omite.
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const relleno = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      '=',
    );
    const datos = JSON.parse(atob(relleno)) as {
      sub?: string;
      email?: string;
      rol?: string;
      taller?: string | null;
    };

    if (!datos.sub || !datos.email || !datos.rol) {
      return null;
    }
    return {
      id: datos.sub,
      email: datos.email,
      rol: datos.rol as UsuarioSesion['rol'],
      taller: datos.taller ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Admin, o superadmin operando dentro del taller que eligio (Sprint 20):
 * para la interfaz son lo mismo. Los permisos reales los decide el backend.
 */
export function actuaComoAdmin(usuario: UsuarioSesion | null | undefined): boolean {
  return usuario?.rol === 'admin' || usuario?.rol === 'superadmin';
}
