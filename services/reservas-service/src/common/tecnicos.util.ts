import { DataSource } from 'typeorm';

export interface TecnicoRow {
  id: string;
  rol: string;
}

const ROL_TECNICO = 'tecnico';

/**
 * `Usuario` es una entidad de usuarios-service, no de reservas-service (no
 * comparten entidades entre si - ver Sprint 3). Ambos servicios apuntan a la
 * misma Postgres, asi que esto consulta la tabla `usuarios` con SQL crudo en
 * vez de importar una entidad que no le pertenece a este servicio. Si algun
 * dia usuarios-service pasa a tener su propia base, este chequeo deberia
 * convertirse en una llamada HTTP a ese servicio.
 */
export async function buscarTecnico(
  dataSource: DataSource,
  tecnicoId: string,
): Promise<TecnicoRow | null> {
  const filas: TecnicoRow[] = await dataSource.query(
    'SELECT id, rol FROM usuarios WHERE id = $1',
    [tecnicoId],
  );
  return filas[0] ?? null;
}

export function esRolTecnico(rol: string): boolean {
  return rol === ROL_TECNICO;
}
