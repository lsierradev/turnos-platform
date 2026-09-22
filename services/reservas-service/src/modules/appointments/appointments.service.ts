import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { buscarTecnico, esRolTecnico } from '../../common/tecnicos.util';
import { Bahia } from '../../entities/bahia.entity';
import { Turno } from '../../entities/turno.entity';
import { ServiciosService } from '../servicios/servicios.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { sugerirHorarios } from './sugerencias-horarios.util';

// Codigo de error de Postgres para exclusion_violation, disparado por
// cualquiera de las dos constraints EXCLUDE USING gist de turnos (bahia o
// tecnico). El nombre de la constraint especifica cual fue.
const CODIGO_EXCLUSION_VIOLATION = '23P01';
const CONSTRAINT_TECNICO = 'turnos_tecnico_rango_excl';

function esErrorDeSolapamiento(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }
  const codigo =
    (error as unknown as { code?: string }).code ??
    (error as unknown as { driverError?: { code?: string } }).driverError?.code;
  return codigo === CODIGO_EXCLUSION_VIOLATION;
}

function nombreConstraintViolada(error: unknown): string | undefined {
  return (
    (error as unknown as { constraint?: string }).constraint ??
    (error as unknown as { driverError?: { constraint?: string } }).driverError
      ?.constraint
  );
}

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectRepository(Turno)
    private readonly turnosRepository: Repository<Turno>,
    @InjectRepository(Bahia)
    private readonly bahiasRepository: Repository<Bahia>,
    private readonly serviciosService: ServiciosService,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateAppointmentDto, usuarioId: string): Promise<Turno> {
    const bahia = await this.bahiasRepository.findOne({
      where: { id: dto.bahiaId },
    });
    if (!bahia) {
      throw new NotFoundException(`Bahia ${dto.bahiaId} no encontrada`);
    }

    const servicio = await this.serviciosService.findOne(dto.servicioId);

    const tecnico = await buscarTecnico(this.dataSource, dto.tecnicoId);
    if (!tecnico || !esRolTecnico(tecnico.rol)) {
      throw new NotFoundException(
        `Tecnico ${dto.tecnicoId} no encontrado o no tiene rol de tecnico`,
      );
    }

    const inicio = new Date(dto.inicio);
    const fin = new Date(inicio.getTime() + servicio.duracionMinutos * 60_000);

    const turno = this.turnosRepository.create({
      bahiaId: dto.bahiaId,
      servicioId: dto.servicioId,
      tecnicoId: dto.tecnicoId,
      usuarioId,
      rangoTiempo: { inicio, fin },
    });

    try {
      return await this.turnosRepository.save(turno);
    } catch (error) {
      if (esErrorDeSolapamiento(error)) {
        const esConflictoDeTecnico =
          nombreConstraintViolada(error) === CONSTRAINT_TECNICO;

        const sugerencias = await this.buscarSugerencias(
          esConflictoDeTecnico
            ? { tecnicoId: dto.tecnicoId }
            : { bahiaId: dto.bahiaId },
          servicio.duracionMinutos,
          inicio,
        );

        throw new ConflictException({
          message: esConflictoDeTecnico
            ? 'El tecnico ya tiene un turno asignado en ese horario.'
            : 'La bahia ya tiene un turno reservado en ese horario.',
          sugerencias,
        });
      }
      throw error;
    }
  }

  private async buscarSugerencias(
    filtro: { bahiaId: string } | { tecnicoId: string },
    duracionMinutos: number,
    inicioSolicitado: Date,
  ) {
    const turnosOcupados = await this.turnosRepository.find({
      where: filtro,
    });

    return sugerirHorarios({
      inicioSolicitado,
      duracionMinutos,
      turnosOcupados: turnosOcupados.map((turno) => turno.rangoTiempo),
    });
  }
}
