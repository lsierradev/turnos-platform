import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Raw, Repository } from 'typeorm';
import { buscarTecnico, esRolTecnico } from '../../common/tecnicos.util';
import {
  fechaEnZona,
  inicioDelDiaEnZona,
  partesEnZona,
  sumarDiasFecha,
  zonaHorariaNegocio,
} from '../../common/zona-horaria.util';
import { Bahia } from '../../entities/bahia.entity';
import { EstadoTurno, Turno } from '../../entities/turno.entity';
import { ServiciosService } from '../servicios/servicios.service';
import { ActualizarEstadoDto } from './dto/actualizar-estado.dto';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import {
  DIAS_BUSQUEDA_DEFAULT,
  HORA_APERTURA_DEFAULT,
  HORA_CIERRE_DEFAULT,
  sugerirHorarios,
} from './sugerencias-horarios.util';

// Codigo de error de Postgres para exclusion_violation, disparado por
// cualquiera de las dos constraints EXCLUDE USING gist de turnos (bahia o
// tecnico). El nombre de la constraint especifica cual fue.
const CODIGO_EXCLUSION_VIOLATION = '23P01';
const CONSTRAINT_TECNICO = 'turnos_tecnico_rango_excl';
const CONSTRAINT_USUARIO = 'turnos_usuario_rango_excl';

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

type FiltroRecurso =
  { bahiaId: string } | { tecnicoId: string } | { usuarioId: string };

function interpretarConflicto(
  constraint: string | undefined,
  ids: { bahiaId: string; tecnicoId: string; usuarioId: string },
): { mensaje: string; filtro: FiltroRecurso } {
  if (constraint === CONSTRAINT_TECNICO) {
    return {
      mensaje: 'El tecnico ya tiene un turno asignado en ese horario.',
      filtro: { tecnicoId: ids.tecnicoId },
    };
  }
  if (constraint === CONSTRAINT_USUARIO) {
    return {
      mensaje: 'Ya tenes otro turno reservado en ese horario.',
      filtro: { usuarioId: ids.usuarioId },
    };
  }
  return {
    mensaje: 'La bahia ya tiene un turno reservado en ese horario.',
    filtro: { bahiaId: ids.bahiaId },
  };
}

/**
 * Reglas de horario que el DTO no puede expresar (dependen de la duracion
 * del servicio, que se resuelve en el servidor).
 *
 * Hasta Sprint 9 no existia ninguna: se podia reservar para 2019, o a las
 * 03:00 de la madrugada. El motor de sugerencias, en cambio, siempre
 * respeto la ventana laboral -- o sea que se podia entrar por la puerta de
 * adelante a un horario que el sistema jamas habria ofrecido.
 */
function validarHorarioReservable(inicio: Date, fin: Date): void {
  if (inicio.getTime() < Date.now()) {
    throw new BadRequestException(
      'No se puede reservar un turno en el pasado.',
    );
  }

  // Ventana laboral en la zona del taller, la misma que usa sugerirHorarios:
  // si estos dos criterios se separan, el sistema sugiere horarios que
  // despues rechaza. El instante que manda el cliente puede venir con
  // cualquier offset (Z, -05:00, ...): lo que importa es a que hora de
  // pared del taller corresponde.
  const zona = zonaHorariaNegocio();
  const localInicio = partesEnZona(inicio, zona);
  const localFin = partesEnZona(fin, zona);
  const horaInicio = localInicio.hora + localInicio.minuto / 60;
  const horaFin = localFin.hora + localFin.minuto / 60;
  const terminaOtroDia =
    fin.getTime() - inicio.getTime() > 0 &&
    fechaEnZona(fin, zona) !== fechaEnZona(inicio, zona);

  if (
    horaInicio < HORA_APERTURA_DEFAULT ||
    terminaOtroDia ||
    horaFin > HORA_CIERRE_DEFAULT
  ) {
    throw new BadRequestException(
      `El turno debe quedar dentro del horario laboral (${HORA_APERTURA_DEFAULT}:00-${HORA_CIERRE_DEFAULT}:00, hora de ${zona}).`,
    );
  }
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

    validarHorarioReservable(inicio, fin);

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
        // Cual de las TRES constraints EXCLUDE se violo define tanto el
        // mensaje como sobre que recurso se buscan alternativas: sugerir
        // huecos de la bahia cuando el que esta ocupado es el cliente
        // devolveria horarios que vuelven a dar 409.
        const constraint = nombreConstraintViolada(error);
        const { mensaje, filtro } = interpretarConflicto(constraint, {
          bahiaId: dto.bahiaId,
          tecnicoId: dto.tecnicoId,
          usuarioId,
        });

        const sugerencias = await this.buscarSugerencias(
          filtro,
          servicio.duracionMinutos,
          inicio,
        );

        throw new ConflictException({
          message: mensaje,
          sugerencias,
        });
      }
      throw error;
    }
  }

  // Cierre del turno (RF-04): es lo que convierte un turno agendado en un
  // dato medible. Sin este endpoint las columnas de 009 nunca se llenan y
  // GET /dashboard/kpis devuelve un dashboard vacio para siempre.
  async actualizarEstado(id: string, dto: ActualizarEstadoDto): Promise<Turno> {
    const turno = await this.turnosRepository.findOne({ where: { id } });
    if (!turno) {
      throw new NotFoundException(`Turno ${id} no encontrado`);
    }

    const atencionInicio = dto.atencionInicio
      ? new Date(dto.atencionInicio)
      : (turno.atencionInicio ?? null);
    const atencionFin = dto.atencionFin
      ? new Date(dto.atencionFin)
      : (turno.atencionFin ?? null);

    // Se valida aca ademas de en turnos_atencion_rango_check (009) para
    // devolver un 400 con mensaje util en vez del 500 crudo que saldria de
    // la violacion de CHECK. La constraint igual se queda: es la que cubre
    // cualquier otra ruta de escritura hacia la tabla.
    if (atencionInicio && atencionFin && atencionFin <= atencionInicio) {
      throw new BadRequestException(
        'atencionFin debe ser posterior a atencionInicio',
      );
    }

    // Las horas de atencion solo tienen sentido en un turno atendido. Si el
    // turno se cierra como no_asistio o cancelado se limpian, para que un
    // cambio de estado no deje colgada una duracion de una marcacion previa
    // que despues se cuele en el promedio del dashboard.
    const esAtendido = dto.estado === EstadoTurno.ATENDIDO;

    turno.estado = dto.estado;
    turno.atencionInicio = esAtendido ? atencionInicio : null;
    turno.atencionFin = esAtendido ? atencionFin : null;

    return this.turnosRepository.save(turno);
  }

  private async buscarSugerencias(
    filtro: FiltroRecurso,
    duracionMinutos: number,
    inicioSolicitado: Date,
  ) {
    // Solo los turnos de la ventana que sugerirHorarios va a explorar.
    //
    // Antes era find({ where: filtro }) a secas: traia TODOS los turnos
    // historicos de esa bahia o ese tecnico para despues mirar 3 dias. Y
    // esta en el camino del 409, o sea que el costo se pagaba justo en el
    // peor momento, cuando hay contencion por el horario.
    //
    // El && lo resuelven los indices GiST de las constraints EXCLUDE (001 y
    // 006), que ya tienen bahia_id / tecnico_id como primera columna.
    //
    // La ventana se corta en dias de NEGOCIO, igual que en sugerirHorarios:
    // si se cortara en dias UTC, a partir de las 19:00 de Bogota la consulta
    // arrancaria en el dia siguiente y las sugerencias ignorarian los turnos
    // ocupados de la tarde local.
    const zona = zonaHorariaNegocio();
    const fecha = fechaEnZona(inicioSolicitado, zona);
    const desde = inicioDelDiaEnZona(fecha, zona);
    const hasta = inicioDelDiaEnZona(
      sumarDiasFecha(fecha, DIAS_BUSQUEDA_DEFAULT),
      zona,
    );

    const turnosOcupados = await this.turnosRepository.find({
      where: {
        ...filtro,
        rangoTiempo: Raw(
          (alias) => `${alias} && tstzrange(:desde, :hasta, '[)')`,
          { desde, hasta },
        ),
      },
    });

    return sugerirHorarios({
      inicioSolicitado,
      duracionMinutos,
      turnosOcupados: turnosOcupados.map((turno) => turno.rangoTiempo),
      zonaHoraria: zona,
    });
  }
}
