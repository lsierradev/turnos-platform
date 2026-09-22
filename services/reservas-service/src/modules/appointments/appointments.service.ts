import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { Bahia } from '../../entities/bahia.entity';
import { Turno } from '../../entities/turno.entity';
import { ServiciosService } from '../servicios/servicios.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { sugerirHorarios } from './sugerencias-horarios.util';

// Codigo de error de Postgres para exclusion_violation, disparado por la
// constraint `turnos_bahia_rango_excl EXCLUDE USING gist` de
// 001_init_turnos.sql cuando dos turnos se solapan en la misma bahia.
const CODIGO_EXCLUSION_VIOLATION = '23P01';

function esErrorDeSolapamiento(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }
  const codigo =
    (error as unknown as { code?: string }).code ??
    (error as unknown as { driverError?: { code?: string } }).driverError?.code;
  return codigo === CODIGO_EXCLUSION_VIOLATION;
}

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectRepository(Turno)
    private readonly turnosRepository: Repository<Turno>,
    @InjectRepository(Bahia)
    private readonly bahiasRepository: Repository<Bahia>,
    private readonly serviciosService: ServiciosService,
  ) {}

  async create(dto: CreateAppointmentDto, usuarioId: string): Promise<Turno> {
    const bahia = await this.bahiasRepository.findOne({
      where: { id: dto.bahiaId },
    });
    if (!bahia) {
      throw new NotFoundException(`Bahia ${dto.bahiaId} no encontrada`);
    }

    const servicio = await this.serviciosService.findOne(dto.servicioId);

    const inicio = new Date(dto.inicio);
    const fin = new Date(inicio.getTime() + servicio.duracionMinutos * 60_000);

    const turno = this.turnosRepository.create({
      bahiaId: dto.bahiaId,
      servicioId: dto.servicioId,
      usuarioId,
      rangoTiempo: { inicio, fin },
    });

    try {
      return await this.turnosRepository.save(turno);
    } catch (error) {
      if (esErrorDeSolapamiento(error)) {
        const sugerencias = await this.buscarSugerencias(
          dto.bahiaId,
          servicio.duracionMinutos,
          inicio,
        );
        throw new ConflictException({
          message: 'La bahia ya tiene un turno reservado en ese horario.',
          sugerencias,
        });
      }
      throw error;
    }
  }

  private async buscarSugerencias(
    bahiaId: string,
    duracionMinutos: number,
    inicioSolicitado: Date,
  ) {
    const turnosDeLaBahia = await this.turnosRepository.find({
      where: { bahiaId },
    });

    return sugerirHorarios({
      inicioSolicitado,
      duracionMinutos,
      turnosOcupados: turnosDeLaBahia.map((turno) => turno.rangoTiempo),
    });
  }
}
