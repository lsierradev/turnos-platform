import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { ContextoDb } from '@turnos-platform/tenant';
import { ContrasenaService } from './contrasena.service';
import { RolUsuario, Usuario } from './entities/usuario.entity';

const SALT_ROUNDS = 10;

// Un probe que tarda mas que esto ya es una dependencia caida a efectos
// practicos: el chequeo de salud no debe heredar el timeout largo de una
// consulta normal y dejar esperando al orquestador.
const TIMEOUT_PROBE_MS = 2_000;

export interface EstadoDependencia {
  status: 'up' | 'down';
  error?: string;
}

export interface Readiness {
  status: 'ok' | 'degraded';
  module: string;
  dependencias: Record<string, EstadoDependencia>;
}

async function probarPostgres(
  dataSource: DataSource,
): Promise<EstadoDependencia> {
  let temporizador: NodeJS.Timeout;
  const limite = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(
      () => rechazar(new Error(`timeout de ${TIMEOUT_PROBE_MS}ms`)),
      TIMEOUT_PROBE_MS,
    );
  });

  try {
    await Promise.race([dataSource.query('SELECT 1'), limite]);
    return { status: 'up' };
  } catch (error) {
    return {
      status: 'down',
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(temporizador!);
  }
}

export interface CrearUsuarioInput {
  /** Taller del personal (admin, tecnico). El cliente no lleva. */
  tallerId?: string | null;
  /** Cliente: taller con el que queda relacionado (clientes_taller). */
  vincularA?: string | null;
  email: string;
  password?: string;
  nombre: string;
  rol?: RolUsuario;
  telefono?: string;
  ciudad?: string;
}

@Injectable()
export class UsuariosService {
  private readonly logger = new Logger(UsuariosService.name);

  constructor(
    @InjectRepository(Usuario)
    private readonly usuariosRepository: Repository<Usuario>,
    private readonly dataSource: DataSource,
    private readonly db: ContextoDb,
  ) {}

  /**
   * Liveness: el proceso responde. No toca Postgres a proposito -- si lo
   * hiciera, una caida momentanea de la base haria que el orquestador
   * reiniciara pods que estan sanos.
   */
  health() {
    return { status: 'ok', module: 'usuarios' };
  }

  /**
   * Readiness: ademas, Postgres responde. Sin esto, un pod sin base se
   * declaraba sano y el balanceador le seguia mandando logins que solo
   * podian fallar.
   */
  async readiness(): Promise<Readiness> {
    const postgres = await probarPostgres(this.dataSource);
    const degradado = postgres.status === 'down';

    if (degradado) {
      this.logger.warn(`Readiness degradado: ${JSON.stringify(postgres)}`);
    }

    return {
      status: degradado ? 'degraded' : 'ok',
      module: 'usuarios',
      dependencias: { postgres },
    };
  }

  /** Para el login: el personal de un taller dado de baja no entra. */
  async tallerActivo(tallerId: string): Promise<boolean> {
    const filas: { activo: boolean }[] = await this.usuariosRepository.query(
      'SELECT activo FROM talleres WHERE id = $1',
      [tallerId],
    );
    return filas[0]?.activo === true;
  }

  findById(id: string): Promise<Usuario | null> {
    return this.usuariosRepository.findOne({ where: { id } });
  }

  findByEmail(email: string): Promise<Usuario | null> {
    return this.usuariosRepository.findOne({ where: { email } });
  }

  /**
   * Usuarios del taller de la sesion (Sprint 20): su personal y sus
   * clientes (los relacionados en clientes_taller). Corre con RLS; el
   * filtro explicito ademas saca lo que RLS deja ver por otros motivos (uno
   * mismo, tecnicos de turnos propios en otros talleres).
   */
  async findAll(rol?: RolUsuario): Promise<Usuario[]> {
    const tallerId = this.db.tallerActual();
    const repo = this.db.repo(Usuario, this.usuariosRepository);
    if (tallerId) {
      const q = repo
        .createQueryBuilder('u')
        .select([
          'u.id',
          'u.email',
          'u.nombre',
          'u.rol',
          'u.telefono',
          'u.ciudad',
          'u.creadoEn',
          'u.actualizadoEn',
        ])
        .where(
          `(u.taller_id = :taller OR EXISTS (
             SELECT 1 FROM clientes_taller ct
              WHERE ct.usuario_id = u.id AND ct.taller_id = :taller))`,
          { taller: tallerId },
        )
        .orderBy('u.nombre', 'ASC');
      if (rol) q.andWhere('u.rol = :rol', { rol });
      return q.getMany();
    }
    return repo.find({
      where: rol ? { rol } : {},
      select: [
        'id',
        'email',
        'nombre',
        'rol',
        'telefono',
        'ciudad',
        'creadoEn',
        'actualizadoEn',
      ],
    });
  }

  async create(input: CrearUsuarioInput): Promise<Usuario> {
    // Sin password (cliente dado de alta por un admin al reservar), la
    // contrasena "por defecto" es un secreto al azar que nadie conoce: el
    // usuario define la suya con el enlace que le llega por correo
    // (UsuariosController.crear). password_hash es NOT NULL, y un hash
    // vacio o fijo seria una contrasena adivinable.
    const password = input.password ?? ContrasenaService.contrasenaInicial();
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const usuario = this.usuariosRepository.create({
      email: input.email,
      passwordHash,
      nombre: input.nombre,
      rol: input.rol ?? RolUsuario.CLIENTE,
      telefono: input.telefono,
      ciudad: input.ciudad?.trim() || null,
      tallerId: input.tallerId ?? null,
    });
    // Con el repositorio inyectado, no el del request: el alta corre en modo
    // sistema. La cuenta de un cliente es global (no pertenece a ningun
    // taller, asi que RLS no la dejaria crear), y ademas el enlace de
    // contrasena que se emite despues tiene que ver la fila ya confirmada.
    // Los permisos (quien crea que, en que taller) los decide el
    // controller, antes de llegar aca.
    try {
      const guardado = await this.usuariosRepository.save(usuario);
      if (input.vincularA) {
        await this.usuariosRepository.query(
          `INSERT INTO clientes_taller (taller_id, usuario_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [input.vincularA, guardado.id],
        );
      }
      return guardado;
    } catch (error) {
      // usuarios_email_key. El filtro global ya lo convertia en 409, pero
      // con el mensaje crudo de Postgres; desde Sprint 17 el admin da de
      // alta clientes desde el formulario de reserva y necesita saber que
      // hacer (buscarlo entre los existentes).
      const codigo = (error as { driverError?: { code?: string } }).driverError
        ?.code;
      if (error instanceof QueryFailedError && codigo === '23505') {
        throw new ConflictException(
          `Ya existe un usuario con el correo ${input.email}.`,
        );
      }
      throw error;
    }
  }
}
