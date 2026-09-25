import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

const ORIGENES_DEV = ['http://localhost:5173', 'http://localhost:8080'];

/**
 * Configuracion de CORS compartida por los dos servicios.
 *
 * Hasta Sprint 10 no habia CORS en ninguno. En produccion admin-web vive en
 * un host distinto al de las APIs (turnos.dominio vs api.dominio /
 * auth.dominio), asi que sin esto el navegador bloquea TODAS las llamadas
 * antes de que salgan: el panel no funcionaria en absoluto, y el sintoma en
 * la consola del navegador no apunta al backend.
 *
 * `CORS_ORIGINS` es una lista separada por comas. En produccion es
 * obligatoria: un `origin: true` (reflejar cualquier origen) en un servicio
 * con tokens en el header Authorization deja que cualquier sitio haga
 * llamadas autenticadas desde el navegador de un usuario logueado.
 *
 * No se habilita `credentials`: la sesion viaja en el header Authorization,
 * no en cookies, asi que no hace falta -- y activarlo sin necesidad amplia
 * la superficie de CSRF.
 */
export function opcionesCors(): CorsOptions {
  const configurados = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (configurados.length === 0) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'CORS_ORIGINS no esta seteada. En produccion hay que declarar ' +
          'explicitamente desde que origenes se acepta al panel.',
      );
    }
    return { origin: ORIGENES_DEV, methods: 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
  }

  return { origin: configurados, methods: 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
}
