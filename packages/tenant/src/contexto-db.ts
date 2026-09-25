import { AsyncLocalStorage } from "async_hooks";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
// SOLO tipos: pnpm resuelve una copia de typeorm para este paquete distinta
// de la de cada servicio, y dos copias de la clase DataSource no son el
// mismo token para Nest. El DataSource real lo pasa el servicio (ver
// TenantModule.conDataSource).
import type {
  DataSource,
  EntityManager,
  EntityTarget,
  ObjectLiteral,
  Repository,
} from "typeorm";

/** Token con el que el servicio le entrega su DataSource a ContextoDb. */
export const DATA_SOURCE_TENANT = "TENANT_DATA_SOURCE";

/** Quien pide y en que taller (Sprint 20). */
export interface Sesion {
  usuarioId: string;
  rol: string;
  /** null: cliente o superadmin que todavia no eligio taller. */
  tallerId: string | null;
}

interface Contexto extends Sesion {
  manager: EntityManager;
}

const almacen = new AsyncLocalStorage<Contexto>();

/** Rol de Postgres sin privilegios sobre el que corren las politicas RLS. */
export const ROL_APP = "turnos_app";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function esUuid(valor: unknown): valor is string {
  return typeof valor === "string" && UUID.test(valor);
}

type Consultable = Pick<DataSource, "query"> | Pick<EntityManager, "query">;

/**
 * Acceso a la base consciente del taller.
 *
 * Cada request autenticado corre entero dentro de UNA transaccion en la que
 * se hizo `SET LOCAL ROLE turnos_app` y se cargaron app.taller_id,
 * app.usuario_id y app.rol (ver `ejecutarComo`). Las politicas de Row Level
 * Security de la migracion 015 filtran cada fila contra esas variables: el
 * codigo puede olvidarse un WHERE taller_id, la base no.
 *
 * Fuera de un request (jobs programados, login, enlaces de contraseña) no
 * hay contexto y todo cae al DataSource normal: el "modo sistema", que es
 * el dueño de las tablas y NO pasa por RLS. Por eso los servicios reciben
 * el repositorio/DataSource inyectado como respaldo: en los tests unitarios
 * (sin contexto) se usan esos mocks sin cambios.
 */
@Injectable()
export class ContextoDb {
  constructor(
    @Inject(DATA_SOURCE_TENANT) private readonly dataSource: DataSource,
  ) {}

  sesion(): Sesion | null {
    const c = almacen.getStore();
    return c
      ? { usuarioId: c.usuarioId, rol: c.rol, tallerId: c.tallerId }
      : null;
  }

  tallerId(): string | null {
    return almacen.getStore()?.tallerId ?? null;
  }

  /** El taller de la sesion, o 400 si el request no eligio uno. */
  exigirTaller(): string {
    const taller = this.tallerId();
    if (!taller) {
      throw new BadRequestException(
        "Elegi un taller: falta el encabezado X-Taller.",
      );
    }
    return taller;
  }

  /**
   * El taller al que pertenece lo que se va a escribir o listar. Dentro de
   * un request lo exige (400 sin X-Taller); fuera de uno (modo sistema,
   * tests unitarios) devuelve null y el llamador no filtra: ahi manda el
   * NOT NULL de la base si algo intenta escribir sin taller.
   */
  tallerActual(): string | null {
    return almacen.getStore() ? this.exigirTaller() : null;
  }

  /** El manager del request, o el del DataSource en modo sistema. */
  manager(): EntityManager {
    return almacen.getStore()?.manager ?? this.dataSource.manager;
  }

  repo<T extends ObjectLiteral>(
    entidad: EntityTarget<T>,
    respaldo?: Repository<T>,
  ): Repository<T> {
    const c = almacen.getStore();
    if (c) return c.manager.getRepository(entidad);
    return respaldo ?? this.dataSource.getRepository(entidad);
  }

  query<T = unknown>(
    sql: string,
    params?: unknown[],
    respaldo?: Consultable,
  ): Promise<T> {
    const c = almacen.getStore();
    return (c ? c.manager : (respaldo ?? this.dataSource)).query(sql, params);
  }

  /** Algo con `.query` que respeta el contexto (para helpers que lo reciben). */
  ejecutor(respaldo?: Consultable): Consultable {
    return {
      query: <T = unknown>(sql: string, params?: unknown[]) =>
        this.query<T>(sql, params, respaldo),
    } as Consultable;
  }

  /**
   * En un request ya estamos en una transaccion: se usa esa (un SET LOCAL
   * adentro dura hasta el final del request, que es lo que se quiere). En
   * modo sistema abre una propia.
   */
  transaccion<T>(
    fn: (manager: EntityManager) => Promise<T>,
    respaldo?: Pick<DataSource, "transaction">,
  ): Promise<T> {
    const c = almacen.getStore();
    if (c) return fn(c.manager);
    return (respaldo ?? this.dataSource).transaction(fn);
  }

  /**
   * Para operaciones que pueden fallar de forma esperada (un 23P01 de
   * turnos solapados) sin tirar abajo el resto del request: en Postgres un
   * error deja la transaccion inservible hasta un ROLLBACK, y el request
   * todavia tiene que buscar sugerencias. Fuera de un request no hace falta.
   */
  async conSavepoint<T>(fn: () => Promise<T>): Promise<T> {
    const c = almacen.getStore();
    if (!c) return fn();
    await c.manager.query("SAVEPOINT paso");
    try {
      const r = await fn();
      await c.manager.query("RELEASE SAVEPOINT paso");
      return r;
    } catch (error) {
      await c.manager.query("ROLLBACK TO SAVEPOINT paso");
      throw error;
    }
  }

  /**
   * Corre `fn` con la sesion dada, dentro de una transaccion con el rol de
   * la app y las variables que leen las politicas. Si el taller no existe o
   * esta dado de baja, corta antes de ejecutar nada.
   */
  async ejecutarComo<T>(sesion: Sesion, fn: () => Promise<T>): Promise<T> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await qr.query(`SET LOCAL ROLE ${ROL_APP}`);
      await qr.query(
        `SELECT set_config('app.taller_id', $1, true),
                set_config('app.usuario_id', $2, true),
                set_config('app.rol', $3, true)`,
        [sesion.tallerId ?? "", sesion.usuarioId, sesion.rol],
      );
      if (sesion.tallerId) {
        const filas: { activo: boolean }[] = await qr.query(
          "SELECT activo FROM talleres WHERE id = $1",
          [sesion.tallerId],
        );
        if (!filas.length) throw new NotFoundException("Taller no encontrado.");
        if (!filas[0].activo && sesion.rol !== "superadmin") {
          throw new ForbiddenException("El taller esta dado de baja.");
        }
      }
      const resultado = await almacen.run(
        { ...sesion, manager: qr.manager },
        fn,
      );
      await qr.commitTransaction();
      return resultado;
    } catch (error) {
      if (qr.isTransactionActive) await qr.rollbackTransaction();
      throw error;
    } finally {
      await qr.release();
    }
  }

  /**
   * Modo sistema explicito dentro de un request: para lo que por diseño no
   * pertenece a un taller (crear la cuenta global de un cliente). Sale del
   * contexto: NO pasa por RLS, asi que el llamador ya tiene que haber
   * verificado permisos.
   */
  sistema<T>(fn: (manager: EntityManager) => Promise<T>): Promise<T> {
    return almacen.exit(() => this.dataSource.transaction(fn));
  }
}
