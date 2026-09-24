import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { DataSource, Repository } from 'typeorm';
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
  email: string;
  password: string;
  nombre: string;
  rol?: RolUsuario;
  telefono?: string;
}

@Injectable()
export class UsuariosService {
  private readonly logger = new Logger(UsuariosService.name);

  constructor(
    @InjectRepository(Usuario)
    private readonly usuariosRepository: Repository<Usuario>,
    private readonly dataSource: DataSource,
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

  findByEmail(email: string): Promise<Usuario | null> {
    return this.usuariosRepository.findOne({ where: { email } });
  }

  findAll(rol?: RolUsuario): Promise<Usuario[]> {
    return this.usuariosRepository.find({
      where: rol ? { rol } : {},
      select: [
        'id',
        'email',
        'nombre',
        'rol',
        'telefono',
        'creadoEn',
        'actualizadoEn',
      ],
    });
  }

  async create(input: CrearUsuarioInput): Promise<Usuario> {
    const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
    const usuario = this.usuariosRepository.create({
      email: input.email,
      passwordHash,
      nombre: input.nombre,
      rol: input.rol ?? RolUsuario.CLIENTE,
      telefono: input.telefono,
    });
    return this.usuariosRepository.save(usuario);
  }
}
