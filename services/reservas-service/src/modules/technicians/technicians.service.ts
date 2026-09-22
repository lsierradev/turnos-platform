import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { buscarTecnico, esRolTecnico } from '../../common/tecnicos.util';
import { Turno } from '../../entities/turno.entity';

// UTC explicito (no hora local): `fecha` llega de `new Date(query.date)`, que
// para un string "YYYY-MM-DD" o con sufijo "Z" siempre representa medianoche
// UTC. Si esto usara setHours/setDate (hora local del proceso), la ventana
// del dia quedaria corrida en cualquier servidor que no corra en UTC.
function inicioDelDia(fecha: Date): Date {
  const dia = new Date(fecha);
  dia.setUTCHours(0, 0, 0, 0);
  return dia;
}

function finDelDia(fecha: Date): Date {
  const dia = inicioDelDia(fecha);
  dia.setUTCDate(dia.getUTCDate() + 1);
  return dia;
}

@Injectable()
export class TechniciansService {
  constructor(
    @InjectRepository(Turno)
    private readonly turnosRepository: Repository<Turno>,
    private readonly dataSource: DataSource,
  ) {}

  async agendaDelDia(tecnicoId: string, fecha: Date): Promise<Turno[]> {
    const tecnico = await buscarTecnico(this.dataSource, tecnicoId);
    if (!tecnico || !esRolTecnico(tecnico.rol)) {
      throw new NotFoundException(
        `Tecnico ${tecnicoId} no encontrado o no tiene rol de tecnico`,
      );
    }

    const desde = inicioDelDia(fecha);
    const hasta = finDelDia(fecha);

    const turnos = await this.turnosRepository.find({
      where: { tecnicoId },
      relations: ['bahia', 'servicio'],
    });

    return turnos
      .filter(
        (turno) =>
          turno.rangoTiempo.inicio >= desde && turno.rangoTiempo.inicio < hasta,
      )
      .sort(
        (a, b) =>
          a.rangoTiempo.inicio.getTime() - b.rangoTiempo.inicio.getTime(),
      );
  }
}
