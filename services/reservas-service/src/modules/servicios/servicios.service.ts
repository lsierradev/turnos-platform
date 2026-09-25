import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ContextoDb } from '@turnos-platform/tenant';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import {
  calcularAnticipo,
  calcularPrecio,
  type Precio,
} from '../../common/precios.util';
import { CreateServicioDto } from './dto/create-servicio.dto';
import { UpdateServicioDto } from './dto/update-servicio.dto';
import { Servicio } from './entities/servicio.entity';

/** Lo que devuelve la API: el servicio con su precio ya calculado. */
export type ServicioConPrecio = Servicio & {
  precio: Precio;
  /** Anticipo sobre el total, o null si el servicio no lo pide. */
  anticipo: { porcentaje: number; centavos: number } | null;
};

@Injectable()
export class ServiciosService {
  constructor(
    @InjectRepository(Servicio)
    private readonly serviciosRepository: Repository<Servicio>,
    private readonly dataSource: DataSource,
    private readonly db: ContextoDb,
  ) {}

  // Repositorio del request (RLS, Sprint 20) o el inyectado fuera de uno.
  private get servicios() {
    return this.db.repo(Servicio, this.serviciosRepository);
  }

  /**
   * Si el taller cobra IVA (Sprint 21). Sin taller o sin configuracion,
   * false: el precio cargado es el final, como hasta Sprint 20.
   */
  async responsableIva(tallerId = this.db.tallerActual()): Promise<boolean> {
    if (!tallerId) return false;
    const [fila] = (await this.db.query(
      'SELECT responsable_iva AS "responsableIva" FROM configuracion_fiscal WHERE taller_id = $1',
      [tallerId],
      this.dataSource,
    )) as { responsableIva: boolean }[];
    return fila?.responsableIva ?? false;
  }

  presentar(servicio: Servicio, responsableIva: boolean): ServicioConPrecio {
    const precio = calcularPrecio(
      servicio.precioBaseCentavos,
      servicio.tarifaIva,
      responsableIva,
    );
    const anticipo = servicio.requiereAnticipo
      ? calcularAnticipo(precio.totalCentavos, servicio.porcentajeAnticipo)
      : null;
    return {
      ...servicio,
      precio,
      anticipo:
        anticipo === null || servicio.porcentajeAnticipo === null
          ? null
          : { porcentaje: servicio.porcentajeAnticipo, centavos: anticipo },
    };
  }

  /**
   * Anticipo coherente (misma regla que servicios_anticipo_check, 016):
   * sin anticipo no hay porcentaje; con anticipo, el porcentaje es
   * obligatorio. Un 400 claro en vez del 409 crudo de la constraint.
   */
  private normalizarAnticipo(servicio: Servicio): void {
    if (!servicio.requiereAnticipo) {
      servicio.porcentajeAnticipo = null;
    } else if (servicio.porcentajeAnticipo == null) {
      throw new BadRequestException(
        'Si el servicio requiere anticipo, indica el porcentaje (15 a 20).',
      );
    }
  }

  async create(dto: CreateServicioDto): Promise<ServicioConPrecio> {
    const tallerId = this.db.tallerActual();
    const servicio = this.servicios.create({
      ...dto,
      ...(tallerId ? { tallerId } : {}),
    });
    this.normalizarAnticipo(servicio);
    const guardado = await this.servicios.save(servicio);
    return this.presentar(guardado, await this.responsableIva());
  }

  /**
   * Los del taller de la sesion. El filtro explicito importa: RLS tambien
   * deja ver al cliente los servicios de sus turnos en OTROS talleres.
   */
  async findAll(): Promise<ServicioConPrecio[]> {
    const tallerId = this.db.tallerActual();
    const servicios = await this.servicios.find({
      ...(tallerId ? { where: { tallerId } } : {}),
      order: { nombre: 'ASC' },
    });
    const responsable = await this.responsableIva(tallerId);
    return servicios.map((s) => this.presentar(s, responsable));
  }

  async findOne(id: string): Promise<Servicio> {
    const servicio = await this.servicios.findOne({ where: { id } });
    if (!servicio) {
      throw new NotFoundException(`Servicio ${id} no encontrado`);
    }
    return servicio;
  }

  async detalle(id: string): Promise<ServicioConPrecio> {
    const servicio = await this.findOne(id);
    return this.presentar(
      servicio,
      await this.responsableIva(servicio.tallerId),
    );
  }

  async update(id: string, dto: UpdateServicioDto): Promise<ServicioConPrecio> {
    const servicio = await this.findOne(id);
    Object.assign(servicio, dto);
    this.normalizarAnticipo(servicio);
    const guardado = await this.servicios.save(servicio);
    return this.presentar(guardado, await this.responsableIva());
  }

  /**
   * Borrar solo un servicio que nunca se uso. Con turnos (la FK de turnos
   * lo impide) se da de baja: activo = false lo saca de la reserva y
   * conserva el historial.
   */
  async remove(id: string): Promise<void> {
    const servicio = await this.findOne(id);
    try {
      await this.db.conSavepoint(() => this.servicios.remove(servicio));
    } catch (error) {
      const codigo = (error as { driverError?: { code?: string } }).driverError
        ?.code;
      if (error instanceof QueryFailedError && codigo === '23503') {
        throw new ConflictException(
          'El servicio ya tiene turnos. Desactivalo en vez de borrarlo: deja de ofrecerse y se conserva el historial.',
        );
      }
      throw error;
    }
  }
}
