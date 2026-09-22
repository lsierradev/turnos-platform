import * as bcrypt from 'bcryptjs';
import { Client } from 'pg';

/**
 * Siembra y limpieza de datos para la suite E2E.
 *
 * Se habla con Postgres directo (driver `pg`) y no via API porque varias de
 * las precondiciones que las HU necesitan NO tienen endpoint: no hay CRUD de
 * bahias, no hay registro de usuarios (ver "Pendiente" en docs/ENDPOINTS.txt)
 * y el estado de un turno solo se puede dejar armado de antemano escribiendo
 * la tabla. Sembrar por SQL mantiene el test enfocado en la HU y no en
 * inventar endpoints que el SRS no pidio.
 *
 * Cada corrida crea sus PROPIAS bahias/tecnico/cliente con un sufijo unico.
 * Es deliberado: las constraints EXCLUDE de turnos son globales a la tabla,
 * asi que compartir una bahia entre corridas haria que dos ejecuciones
 * simultaneas (o una corrida que dejo basura) se pisen entre si y fallen por
 * un conflicto que no es el que el test esta probando.
 */

const DATABASE_URL = process.env.DATABASE_URL;

export const PASSWORD_DE_PRUEBA = 'e2e-password-123';

export interface DatosSembrados {
  sufijo: string;
  bahiaId: string;
  otraBahiaId: string;
  servicioId: string;
  duracionMinutos: number;
  clienteId: string;
  clienteEmail: string;
  tecnicoId: string;
  tecnicoEmail: string;
}

function clienteDb(): Client {
  if (!DATABASE_URL) {
    throw new Error(
      'DATABASE_URL no esta seteada: la suite E2E necesita la misma Postgres ' +
        'que usan los servicios. Ver e2e/README.md.',
    );
  }
  return new Client({ connectionString: DATABASE_URL });
}

async function conConexion<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = clienteDb();
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

export const DURACION_SERVICIO_MINUTOS = 30;

export async function sembrar(): Promise<DatosSembrados> {
  const sufijo = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const passwordHash = await bcrypt.hash(PASSWORD_DE_PRUEBA, 10);

  return conConexion(async (db) => {
    const bahia = await db.query(
      'INSERT INTO bahias (nombre) VALUES ($1) RETURNING id',
      [`Bahia E2E ${sufijo}`],
    );
    const otraBahia = await db.query(
      'INSERT INTO bahias (nombre) VALUES ($1) RETURNING id',
      [`Bahia E2E alterna ${sufijo}`],
    );

    const servicio = await db.query(
      `INSERT INTO servicios (nombre, categoria, duracion_minutos, precio)
       VALUES ($1, 'mecanica', $2, 25000) RETURNING id`,
      [`Cambio de aceite E2E ${sufijo}`, DURACION_SERVICIO_MINUTOS],
    );

    const clienteEmail = `cliente-e2e-${sufijo}@turnos.dev`;
    const cliente = await db.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol)
       VALUES ($1, $2, 'Cliente E2E', 'cliente') RETURNING id`,
      [clienteEmail, passwordHash],
    );

    const tecnicoEmail = `tecnico-e2e-${sufijo}@turnos.dev`;
    const tecnico = await db.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol)
       VALUES ($1, $2, 'Tecnico E2E', 'tecnico') RETURNING id`,
      [tecnicoEmail, passwordHash],
    );

    return {
      sufijo,
      bahiaId: bahia.rows[0].id,
      otraBahiaId: otraBahia.rows[0].id,
      servicioId: servicio.rows[0].id,
      duracionMinutos: DURACION_SERVICIO_MINUTOS,
      clienteId: cliente.rows[0].id,
      clienteEmail,
      tecnicoId: tecnico.rows[0].id,
      tecnicoEmail,
    };
  });
}

export async function limpiar(datos: DatosSembrados): Promise<void> {
  await conConexion(async (db) => {
    // Orden impuesto por las FK: notificaciones -> turnos -> el resto.
    await db.query(
      `DELETE FROM notificaciones
       WHERE turno_id IN (SELECT id FROM turnos WHERE bahia_id = ANY($1))`,
      [[datos.bahiaId, datos.otraBahiaId]],
    );
    await db.query('DELETE FROM turnos WHERE bahia_id = ANY($1)', [
      [datos.bahiaId, datos.otraBahiaId],
    ]);
    await db.query('DELETE FROM servicios WHERE id = $1', [datos.servicioId]);
    await db.query('DELETE FROM bahias WHERE id = ANY($1)', [
      [datos.bahiaId, datos.otraBahiaId],
    ]);
    await db.query('DELETE FROM usuarios WHERE id = ANY($1)', [
      [datos.clienteId, datos.tecnicoId],
    ]);
  });
}

export interface TurnoSembrado {
  inicio: Date;
  estado: 'programado' | 'atendido' | 'no_asistio' | 'cancelado';
  minutosAtencion?: number;
}

/**
 * Inserta turnos ya cerrados. Los necesita la HU del dashboard: los KPIs
 * se calculan sobre turnos con estado y horas reales de atencion, y no hay
 * forma de llegar a ese estado solo reservando (haria falta ademas pasar
 * por PATCH /appointments/:id/estado uno por uno).
 */
export async function sembrarTurnos(
  datos: DatosSembrados,
  turnos: TurnoSembrado[],
): Promise<string[]> {
  return conConexion(async (db) => {
    const ids: string[] = [];
    for (const turno of turnos) {
      const fin = new Date(
        turno.inicio.getTime() + datos.duracionMinutos * 60_000,
      );
      const atencionInicio =
        turno.minutosAtencion === undefined ? null : turno.inicio;
      const atencionFin =
        turno.minutosAtencion === undefined
          ? null
          : new Date(turno.inicio.getTime() + turno.minutosAtencion * 60_000);

      const fila = await db.query(
        `INSERT INTO turnos
           (bahia_id, servicio_id, usuario_id, tecnico_id, rango_tiempo,
            estado, atencion_inicio, atencion_fin)
         VALUES ($1, $2, $3, $4,
                 tstzrange($5::timestamptz, $6::timestamptz, '[)'),
                 $7::estado_turno, $8::timestamptz, $9::timestamptz)
         RETURNING id`,
        [
          datos.bahiaId,
          datos.servicioId,
          datos.clienteId,
          datos.tecnicoId,
          turno.inicio.toISOString(),
          fin.toISOString(),
          turno.estado,
          atencionInicio?.toISOString() ?? null,
          atencionFin?.toISOString() ?? null,
        ],
      );
      ids.push(fila.rows[0].id);
    }
    return ids;
  });
}

/**
 * Un horario dentro de la ventana laboral (08:00-18:00 UTC, ver
 * sugerencias-horarios.util.ts) y en el futuro, para que la reserva sea
 * agendable y las sugerencias ante conflicto tengan donde caer.
 *
 * `diasAdelante` por defecto es 2 y no 0: reservar "hoy" a las 09:00 falla
 * de forma intermitente si la suite corre despues de esa hora, porque ya no
 * quedan huecos hacia adelante en el dia.
 */
export function horarioLaboral(hora: number, diasAdelante = 2): Date {
  const fecha = new Date();
  fecha.setUTCDate(fecha.getUTCDate() + diasAdelante);
  fecha.setUTCHours(hora, 0, 0, 0);
  return fecha;
}

export function fechaISO(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}
