/**
 * Lectura de secretos de entorno con corte en produccion.
 *
 * Antes, JWT_SECRET y JWT_REFRESH_SECRET tenian un fallback literal
 * ('dev-secret-change-me') aplicado en silencio. Eso hace comodo el
 * desarrollo local, pero significa que un deploy al que se le olvido setear
 * la variable ARRANCA IGUAL y firma tokens con un secreto que esta
 * publicado en este repositorio: cualquiera puede fabricarse un token con
 * el rol que quiera y el servicio lo acepta. No hay ninguna senal de que
 * eso este pasando -- todo "funciona".
 *
 * En produccion se prefiere no arrancar. Fuera de produccion se mantiene el
 * fallback para no romper el desarrollo local ni los tests.
 *
 * Es el mismo criterio que ya usaba getKey() en encryption.util.ts, que
 * tira si falta ENCRYPTION_KEY; esto lo extiende al resto de los secretos.
 */
export function secretoRequerido(nombre: string, fallbackDev: string): string {
  const valor = process.env[nombre];
  if (valor) {
    return valor;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `${nombre} no esta seteada. En produccion no se arranca con el ` +
        'secreto de desarrollo: seria un secreto publico.',
    );
  }

  return fallbackDev;
}

export const JWT_SECRET_FALLBACK_DEV = 'dev-secret-change-me';
export const JWT_REFRESH_SECRET_FALLBACK_DEV = 'dev-refresh-secret-change-me';
