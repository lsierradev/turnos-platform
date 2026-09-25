import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ContextoDb } from '@turnos-platform/tenant';
import { QueryFailedError, Repository } from 'typeorm';
import {
  ContrasenaService,
  type Emision,
} from '../usuarios/contrasena.service';
import { RolUsuario, Usuario } from '../usuarios/entities/usuario.entity';
import { ActualizarTallerDto, CrearTallerDto } from './talleres.dto';
import { Taller } from './taller.entity';

const codigoPg = (error: unknown) =>
  error instanceof QueryFailedError
    ? (
        error as unknown as {
          driverError?: { code?: string; constraint?: string };
        }
      ).driverError
    : undefined;

@Injectable()
export class TalleresService {
  constructor(
    @InjectRepository(Taller)
    private readonly talleresRepository: Repository<Taller>,
    private readonly db: ContextoDb,
    private readonly contrasena: ContrasenaService,
  ) {}

  /**
   * Los talleres que el usuario puede ver, por RLS: los activos (el cliente
   * elige donde reservar), el propio y, para el superadmin, todos.
   */
  listar(): Promise<Taller[]> {
    return this.db
      .repo(Taller, this.talleresRepository)
      .find({ order: { nombre: 'ASC' } });
  }

  /**
   * Alta de un taller con su primer admin (solo superadmin; lo controla el
   * guard). Corre en modo sistema y en UNA transaccion: el admin tiene que
   * nacer dentro del taller recien creado, que todavia no es el taller de
   * ninguna sesion. El admin recibe el enlace para definir su contrasena.
   */
  async crear(dto: CrearTallerDto): Promise<{
    taller: Taller;
    admin: Pick<Usuario, 'id' | 'email' | 'nombre'>;
    invitacion: Emision;
  }> {
    let creado: { taller: Taller; admin: Usuario };
    try {
      creado = await this.db.sistema(async (manager) => {
        const taller = await manager
          .getRepository(Taller)
          .save(
            manager
              .getRepository(Taller)
              .create({ nombre: dto.nombre.trim(), slug: dto.slug }),
          );
        const admin = await manager.getRepository(Usuario).save(
          manager.getRepository(Usuario).create({
            email: dto.admin.email.trim(),
            nombre: dto.admin.nombre.trim(),
            rol: RolUsuario.ADMIN,
            tallerId: taller.id,
            passwordHash: await ContrasenaService.hashInicial(),
          }),
        );
        return { taller, admin };
      });
    } catch (error) {
      const pg = codigoPg(error);
      if (pg?.code === '23505') {
        throw new ConflictException(
          pg.constraint === 'talleres_slug_key'
            ? `Ya existe un taller con el identificador "${dto.slug}".`
            : `Ya existe un usuario con el correo ${dto.admin.email}.`,
        );
      }
      throw error;
    }
    const invitacion = await this.contrasena.emitir(creado.admin, 'alta');
    const { id, email, nombre } = creado.admin;
    return { taller: creado.taller, admin: { id, email, nombre }, invitacion };
  }

  /** Renombrar o dar de baja/alta (solo superadmin; RLS lo exige tambien). */
  async actualizar(id: string, dto: ActualizarTallerDto): Promise<Taller> {
    const repo = this.db.repo(Taller, this.talleresRepository);
    const taller = await repo.findOne({ where: { id } });
    if (!taller) throw new NotFoundException(`Taller ${id} no encontrado`);
    if (dto.nombre !== undefined) taller.nombre = dto.nombre.trim();
    if (dto.activo !== undefined) taller.activo = dto.activo;
    return repo.save(taller);
  }
}
