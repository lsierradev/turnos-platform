import { ConflictException } from '@nestjs/common';

type Ejecutor = {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
};

/**
 * Condiciones del taller (Sprint 23) que el cliente tiene que haber
 * aceptado: al reservar y, desde el Sprint 24, antes de pagar un anticipo
 * (son las que dicen cuando se devuelve). Devuelve la version vigente que
 * acepto, o null si el taller no publico condiciones. 409
 * CONDICIONES_PENDIENTES si no acepto la vigente.
 */
export async function exigirCondiciones(
  sql: Ejecutor,
  tallerId: string,
  usuarioId: string,
  accion: 'reservar' | 'pagar',
): Promise<number | null> {
  const [vigente] = (await sql.query(
    `SELECT c.version,
            EXISTS (SELECT 1 FROM aceptaciones_legales a
                     WHERE a.usuario_id = $2 AND a.taller_id = c.taller_id
                       AND a.documento = 'condiciones_taller'
                       AND a.version = c.version) AS aceptada
       FROM condiciones_taller c
      WHERE c.taller_id = $1
      ORDER BY c.version DESC
      LIMIT 1`,
    [tallerId, usuarioId],
  )) as { version: number; aceptada: boolean }[];
  if (!vigente) return null;
  if (!vigente.aceptada) {
    throw new ConflictException({
      message: `Antes de ${accion} hay que aceptar las condiciones del taller (version ${vigente.version}).`,
      codigo: 'CONDICIONES_PENDIENTES',
      version: vigente.version,
    });
  }
  return vigente.version;
}
