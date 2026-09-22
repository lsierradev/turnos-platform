import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateServicioDto } from './dto/create-servicio.dto';
import { UpdateServicioDto } from './dto/update-servicio.dto';
import { Servicio } from './entities/servicio.entity';

@Injectable()
export class ServiciosService {
  constructor(
    @InjectRepository(Servicio)
    private readonly serviciosRepository: Repository<Servicio>,
  ) {}

  create(dto: CreateServicioDto): Promise<Servicio> {
    const servicio = this.serviciosRepository.create(dto);
    return this.serviciosRepository.save(servicio);
  }

  findAll(): Promise<Servicio[]> {
    return this.serviciosRepository.find();
  }

  async findOne(id: string): Promise<Servicio> {
    const servicio = await this.serviciosRepository.findOne({ where: { id } });
    if (!servicio) {
      throw new NotFoundException(`Servicio ${id} no encontrado`);
    }
    return servicio;
  }

  async update(id: string, dto: UpdateServicioDto): Promise<Servicio> {
    const servicio = await this.findOne(id);
    Object.assign(servicio, dto);
    return this.serviciosRepository.save(servicio);
  }

  async remove(id: string): Promise<void> {
    const servicio = await this.findOne(id);
    await this.serviciosRepository.remove(servicio);
  }
}
