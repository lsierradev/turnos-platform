import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ContextoDb } from '@turnos-platform/tenant';
import { Repository } from 'typeorm';
import { CreateServicioDto } from './dto/create-servicio.dto';
import { UpdateServicioDto } from './dto/update-servicio.dto';
import { Servicio } from './entities/servicio.entity';

@Injectable()
export class ServiciosService {
  constructor(
    @InjectRepository(Servicio)
    private readonly serviciosRepository: Repository<Servicio>,
    private readonly db: ContextoDb,
  ) {}

  // Repositorio del request (RLS, Sprint 20) o el inyectado fuera de uno.
  private get servicios() {
    return this.db.repo(Servicio, this.serviciosRepository);
  }

  create(dto: CreateServicioDto): Promise<Servicio> {
    const tallerId = this.db.tallerActual();
    const servicio = this.servicios.create({
      ...dto,
      ...(tallerId ? { tallerId } : {}),
    });
    return this.servicios.save(servicio);
  }

  /**
   * Los del taller de la sesion. El filtro explicito importa: RLS tambien
   * deja ver al cliente los servicios de sus turnos en OTROS talleres.
   */
  findAll(): Promise<Servicio[]> {
    const tallerId = this.db.tallerActual();
    return this.servicios.find(tallerId ? { where: { tallerId } } : {});
  }

  async findOne(id: string): Promise<Servicio> {
    const servicio = await this.servicios.findOne({ where: { id } });
    if (!servicio) {
      throw new NotFoundException(`Servicio ${id} no encontrado`);
    }
    return servicio;
  }

  async update(id: string, dto: UpdateServicioDto): Promise<Servicio> {
    const servicio = await this.findOne(id);
    Object.assign(servicio, dto);
    return this.servicios.save(servicio);
  }

  async remove(id: string): Promise<void> {
    const servicio = await this.findOne(id);
    await this.servicios.remove(servicio);
  }
}
