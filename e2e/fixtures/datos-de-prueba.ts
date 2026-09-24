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

export interface UsuarioSembrado {
  id: string;
  email: string;
}

export interface DatosSembrados {
  sufijo: string;
  bahiaId: string;
  otraBahiaId: string;
  servicioId: string;
  duracionMinutos: number;
  /**
   * Varios clientes, no uno solo. Desde la migracion 010 un mismo usuario no
   * puede tener dos turnos solapados (constraint turnos_usuario_rango_excl),
   * asi que probar el conflicto de BAHIA con el mismo cliente dos veces
   * violaria las dos constraints a la vez y el mensaje del 409 dependeria de
   * cual evalue Postgres primero. Dos clientes distintos peleando por el
   * mismo horario es ademas el escenario real.
   */
  clientes: UsuarioSembrado[];
  clienteId: string;
  clienteEmail: string;
  adminId: string;
  adminEmail: string;
  tecnicoId: string;
  tecnicoEmail: string;
  /**
   * Segundo tecnico, para aislar el conflicto de un cliente consigo mismo:
   * si se reusara el primero, se violarian a la vez la constraint de tecnico
   * y la de usuario, y el mensaje del 409 dependeria de cual evalue Postgres
   * antes.
   */
  otroTecnicoId: string;
}

const CANTIDAD_CLIENTES = 5;

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

    const clientes: UsuarioSembrado[] = [];
    for (let i = 0; i < CANTIDAD_CLIENTES; i += 1) {
      const email = `cliente-e2e-${i}-${sufijo}@turnos.dev`;
      const fila = await db.query(
        `INSERT INTO usuarios (email, password_hash, nombre, rol)
         VALUES ($1, $2, $3, 'cliente') RETURNING id`,
        [email, passwordHash, `Cliente E2E ${i}`],
      );
      clientes.push({ id: fila.rows[0].id, email });
    }

    const adminEmail = `admin-e2e-${sufijo}@turnos.dev`;
    const admin = await db.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol)
       VALUES ($1, $2, 'Admin E2E', 'admin') RETURNING id`,
      [adminEmail, passwordHash],
    );

    const tecnicoEmail = `tecnico-e2e-${sufijo}@turnos.dev`;
    const tecnico = await db.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol)
       VALUES ($1, $2, $3, 'tecnico') RETURNING id`,
      // Con sufijo: el formulario de reserva lo elige por nombre, y una
      // corrida anterior que no llego a limpiar dejaria dos iguales.
      [tecnicoEmail, passwordHash, `Tecnico E2E ${sufijo}`],
    );

    const otroTecnico = await db.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol)
       VALUES ($1, $2, $3, 'tecnico') RETURNING id`,
      [`tecnico2-e2e-${sufijo}@turnos.dev`, passwordHash, `Otro tecnico E2E ${sufijo}`],
    );

    return {
      sufijo,
      bahiaId: bahia.rows[0].id,
      otraBahiaId: otraBahia.rows[0].id,
      servicioId: servicio.rows[0].id,
      duracionMinutos: DURACION_SERVICIO_MINUTOS,
      clientes,
      clienteId: clientes[0].id,
      clienteEmail: clientes[0].email,
      adminId: admin.rows[0].id,
      adminEmail,
      tecnicoId: tecnico.rows[0].id,
      tecnicoEmail,
      otroTecnicoId: otroTecnico.rows[0].id,
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
      [
        ...datos.clientes.map((c) => c.id),
        datos.adminId,
        datos.tecnicoId,
        datos.otroTecnicoId,
      ],
    ]);
  });
}

/**
 * Borra usuarios que creo la propia prueba por la pantalla (p. ej. el
 * cliente que da de alta un admin al reservar), con sus turnos. Va despues
 * de limpiar(): esos usuarios no estan en DatosSembrados.
 */
export async function borrarUsuariosPorEmail(emails: string[]): Promise<void> {
  await conConexion(async (db) => {
    await db.query(
      `DELETE FROM notificaciones WHERE turno_id IN (
         SELECT t.id FROM turnos t JOIN usuarios u ON u.id = t.usuario_id
         WHERE u.email = ANY($1))`,
      [emails],
    );
    await db.query(
      'DELETE FROM turnos WHERE usuario_id IN (SELECT id FROM usuarios WHERE email = ANY($1))',
      [emails],
    );
    await db.query('DELETE FROM usuarios WHERE email = ANY($1)', [emails]);
  });
}

/**
 * Enlace de contrasena listo para usar (Sprint 18). El real solo viaja por
 * correo; este se guarda igual que lo guarda usuarios-service (SHA-256 del
 * token) y devuelve el token en claro para armar la URL.
 */
export async function sembrarTokenContrasena(usuarioId: string): Promise<string> {
  const { createHash, randomBytes } = await import('crypto');
  const token = randomBytes(32).toString('base64url');
  await conConexion((db) =>
    db.query(
      `INSERT INTO tokens_contrasena (usuario_id, token_hash, motivo, expira_en)
       VALUES ($1, $2, 'alta', now() + interval '1 hour')`,
      [usuarioId, createHash('sha256').update(token).digest('hex')],
    ),
  );
  return token;
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
 * Hora del TALLER (Sprint 12). La suite asume TZ_NEGOCIO = America/Bogota,
 * el default de reservas-service y de admin-web: UTC-5 fijo, sin horario de
 * verano, asi que el offset va escrito a mano en vez de reusar el codigo de
 * la app (un test que convierte con el mismo codigo que prueba no prueba
 * nada).
 */
const OFFSET_TALLER = '-05:00';
const OFFSET_TALLER_MS = -5 * 3_600_000;

/** Fecha (YYYY-MM-DD) en que cae `instante` para el taller. */
export function fechaISO(instante: Date): string {
  return new Date(instante.getTime() + OFFSET_TALLER_MS)
    .toISOString()
    .slice(0, 10);
}

/** Hoy (YYYY-MM-DD) para el taller. */
export function hoyEnTaller(): string {
  return fechaISO(new Date());
}

/** Hora de pared HH:MM del taller para `instante`. */
export function horaEnTaller(instante: Date): string {
  return new Date(instante.getTime() + OFFSET_TALLER_MS)
    .toISOString()
    .slice(11, 16);
}

/** El instante de las `hora`:`minuto` del taller el dia `fecha`. */
export function aLasEnTaller(fecha: string, hora: number, minuto = 0): Date {
  const hh = String(hora).padStart(2, '0');
  const mm = String(minuto).padStart(2, '0');
  return new Date(`${fecha}T${hh}:${mm}:00${OFFSET_TALLER}`);
}

/**
 * Un horario dentro de la ventana laboral (08:00-18:00 hora del taller, ver
 * sugerencias-horarios.util.ts) y en el futuro, para que la reserva sea
 * agendable y las sugerencias ante conflicto tengan donde caer.
 *
 * `diasAdelante` por defecto es 2 y no 0: reservar "hoy" a las 09:00 falla
 * de forma intermitente si la suite corre despues de esa hora, porque ya no
 * quedan huecos hacia adelante en el dia.
 */
export function horarioLaboral(hora: number, diasAdelante = 2): Date {
  const fecha = new Date(`${hoyEnTaller()}T00:00:00.000Z`);
  fecha.setUTCDate(fecha.getUTCDate() + diasAdelante);
  return aLasEnTaller(fecha.toISOString().slice(0, 10), hora);
}
