import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Not, QueryFailedError, Raw, Repository } from 'typeorm';
import {
  buscarTecnico,
  buscarUsuario,
  esRolTecnico,
} from '../../common/tecnicos.util';
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
import { DisponibilidadQueryDto } from './dto/disponibilidad-query.dto';
import {
  DIAS_BUSQUEDA_DEFAULT,
  HORA_APERTURA_DEFAULT,
  HORA_CIERRE_DEFAULT,
  horariosLibresDelDia,
  sugerirHorarios,
} from './sugerencias-horarios.util';

// Codigo de error de Postgres para exclusion_violation, disparado por
// cualquiera de las dos constraints EXCLUDE USING gist de turnos (bahia o
// tecnico). El nombre de la constraint especifica cual fue.
const CODIGO_EXCLUSION_VIOLATION = '23P01';
const CONSTRAINT_TECNICO = 'turnos_tecnico_rango_excl';
const CONSTRAINT_USUARIO = 'turnos_usuario_rango_excl';
// Valores de rol_usuario (tabla de usuarios-service; ver tecnicos.util.ts).
const ROL_ADMIN = 'admin';
const ROL_CLIENTE = 'cliente';

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
  paraCliente = false,
): { mensaje: string; filtro: FiltroRecurso } {
  if (constraint === CONSTRAINT_TECNICO) {
    return {
      mensaje: 'El tecnico ya tiene un turno asignado en ese horario.',
      filtro: { tecnicoId: ids.tecnicoId },
    };
  }
  if (constraint === CONSTRAINT_USUARIO) {
    return {
      mensaje: paraCliente
        ? 'El cliente ya tiene otro turno reservado en ese horario.'
        : 'Ya tenes otro turno reservado en ese horario.',
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

function dosDigitos(n: number): string {
  return String(n).padStart(2, '0');
}

// Tope de "Mis turnos": un cliente no tiene cientos en 90 dias; si los
// tuviera, la lista igual no se leeria entera.
const MAX_MIS_TURNOS = 100;

interface FilaMiTurno {
  id: string;
  inicio: Date;
  fin: Date;
  estado: EstadoTurno;
  bahiaNombre: string;
  servicioNombre: string;
  servicioCategoria: string;
  tecnicoNombre: string | null;
}

export interface MiTurno {
  id: string;
  inicio: string;
  fin: string;
  estado: EstadoTurno;
  bahia: string;
  servicio: { nombre: string; categoria: string };
  tecnico: string | null;
}

export interface DisponibilidadResponse {
  fecha: string;
  zonaHoraria: string;
  duracionMinutos: number;
  jornada: { apertura: string; cierre: string };
  horarios: { inicio: Date; fin: Date }[];
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

  /**
   * A nombre de quien queda el turno. Por defecto, de quien reserva (el
   * `sub` del JWT, nunca un id del body). Un admin puede pasar clienteId
   * para reservar por un cliente (Sprint 17); cualquier otro rol que lo
   * mande recibe 403: si no, un cliente podria reservar a nombre de otro.
   */
  async resolverTitular(
    usuario: { sub: string; rol: string },
    clienteId?: string,
  ): Promise<{ usuarioId: string; paraCliente: boolean }> {
    if (!clienteId || clienteId === usuario.sub) {
      return { usuarioId: usuario.sub, paraCliente: false };
    }
    if (usuario.rol !== ROL_ADMIN) {
      throw new ForbiddenException(
        'Solo un administrador puede reservar a nombre de otro usuario.',
      );
    }
    const cliente = await buscarUsuario(this.dataSource, clienteId);
    if (!cliente || cliente.rol !== ROL_CLIENTE) {
      throw new NotFoundException(
        `Cliente ${clienteId} no encontrado o no tiene rol de cliente`,
      );
    }
    return { usuarioId: clienteId, paraCliente: true };
  }

  /**
   * Bahia, servicio y tecnico tienen que existir y estar en uso. Comun a la
   * reserva y a la grilla de disponibilidad: si la grilla aceptara algo que
   * el POST rechaza, el usuario elegiria un horario que no puede reservar.
   *
   * Hasta Sprint 17 una bahia o un servicio dados de baja (activa/activo =
   * false) se podian reservar igual con solo conocer su id.
   */
  private async validarRecursos(ids: {
    bahiaId: string;
    servicioId: string;
    tecnicoId: string;
  }) {
    const bahia = await this.bahiasRepository.findOne({
      where: { id: ids.bahiaId },
    });
    if (!bahia || !bahia.activa) {
      throw new NotFoundException(
        `Bahia ${ids.bahiaId} no encontrada o fuera de servicio`,
      );
    }

    const servicio = await this.serviciosService.findOne(ids.servicioId);
    if (!servicio.activo) {
      throw new NotFoundException(
        `Servicio ${ids.servicioId} no esta disponible`,
      );
    }

    const tecnico = await buscarTecnico(this.dataSource, ids.tecnicoId);
    if (!tecnico || !esRolTecnico(tecnico.rol)) {
      throw new NotFoundException(
        `Tecnico ${ids.tecnicoId} no encontrado o no tiene rol de tecnico`,
      );
    }

    return { bahia, servicio };
  }

  /**
   * Horarios reservables de un dia para esa bahia + tecnico, sin pisar
   * tampoco otro turno del propio usuario (las tres EXCLUDE de 001/006/010).
   * Es la grilla del formulario de reserva (Sprint 17).
   *
   * Sin cache a proposito, a diferencia de /bahias/carga: es lo que el
   * usuario mira justo antes de reservar, y un hueco viejo de hace 5 s es
   * exactamente el que despues da 409. Igual puede quedar vieja entre la
   * consulta y el POST; para eso esta el 409 con sugerencias.
   */
  async disponibilidad(
    query: DisponibilidadQueryDto,
    usuarioId: string,
  ): Promise<DisponibilidadResponse> {
    const { fecha } = query;
    // 2026-02-31 pasa el formato del DTO, pero Date.UTC lo corre al 3 de
    // marzo sin avisar.
    if (sumarDiasFecha(fecha, 0) !== fecha) {
      throw new BadRequestException(`La fecha ${fecha} no existe`);
    }

    const { servicio } = await this.validarRecursos(query);

    const zona = zonaHorariaNegocio();
    const desde = inicioDelDiaEnZona(fecha, zona);
    const hasta = inicioDelDiaEnZona(sumarDiasFecha(fecha, 1), zona);
    const enElDia = {
      estado: Not(EstadoTurno.CANCELADO),
      rangoTiempo: Raw(
        (alias) => `${alias} && tstzrange(:desde, :hasta, '[)')`,
        { desde, hasta },
      ),
    };

    // Un OR de tres filtros: cada rama la resuelve el GiST parcial de su
    // constraint EXCLUDE (bahia_id / tecnico_id / usuario_id primero).
    const ocupados = await this.turnosRepository.find({
      where: [
        { ...enElDia, bahiaId: query.bahiaId },
        { ...enElDia, tecnicoId: query.tecnicoId },
        { ...enElDia, usuarioId },
      ],
    });

    return {
      fecha,
      zonaHoraria: zona,
      duracionMinutos: servicio.duracionMinutos,
      jornada: {
        apertura: `${dosDigitos(HORA_APERTURA_DEFAULT)}:00`,
        cierre: `${dosDigitos(HORA_CIERRE_DEFAULT)}:00`,
      },
      horarios: horariosLibresDelDia({
        fecha,
        duracionMinutos: servicio.duracionMinutos,
        turnosOcupados: ocupados.map((t) => t.rangoTiempo),
        ahora: new Date(),
        zonaHoraria: zona,
      }),
    };
  }

  async create(
    dto: CreateAppointmentDto,
    usuarioId: string,
    paraCliente = false,
  ): Promise<Turno> {
    const { servicio } = await this.validarRecursos(dto);

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
        const { mensaje, filtro } = interpretarConflicto(
          constraint,
          { bahiaId: dto.bahiaId, tecnicoId: dto.tecnicoId, usuarioId },
          paraCliente,
        );

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

    const estadoAnterior = turno.estado;
    turno.estado = dto.estado;
    turno.atencionInicio = esAtendido ? atencionInicio : null;
    turno.atencionFin = esAtendido ? atencionFin : null;

    try {
      return await this.turnosRepository.save(turno);
    } catch (error) {
      // Desde 011 un cancelado libera su horario. Reactivarlo (sacarlo de
      // "cancelado") vuelve a hacerlo competir en las EXCLUDE: si otro
      // turno ya tomo la bahia, el tecnico o el cliente en ese horario, el
      // UPDATE falla con 23P01. Sin esto salia como 500.
      if (
        esErrorDeSolapamiento(error) &&
        estadoAnterior === EstadoTurno.CANCELADO
      ) {
        const { mensaje } = interpretarConflicto(
          nombreConstraintViolada(error),
          {
            bahiaId: turno.bahiaId,
            tecnicoId: turno.tecnicoId ?? '',
            usuarioId: turno.usuarioId ?? '',
          },
        );
        throw new ConflictException(
          `No se puede reactivar el turno: su horario ya fue tomado. ${mensaje}`,
        );
      }
      throw error;
    }
  }

  /**
   * Turnos del propio usuario (Sprint 18, "Mis turnos" del cliente): los
   * que vienen y los ultimos 90 dias. Nombre del tecnico por SQL crudo,
   * igual que el detalle de bahia (usuarios es tabla de usuarios-service).
   */
  async misTurnos(usuarioId: string): Promise<MiTurno[]> {
    const filas: FilaMiTurno[] = await this.dataSource.query(
      `SELECT t.id,
              lower(t.rango_tiempo) AS inicio,
              upper(t.rango_tiempo) AS fin,
              t.estado,
              b.nombre             AS "bahiaNombre",
              s.nombre             AS "servicioNombre",
              s.categoria          AS "servicioCategoria",
              tec.nombre           AS "tecnicoNombre"
         FROM turnos t
         JOIN bahias b    ON b.id = t.bahia_id
         JOIN servicios s ON s.id = t.servicio_id
         LEFT JOIN usuarios tec ON tec.id = t.tecnico_id
        WHERE t.usuario_id = $1
          AND lower(t.rango_tiempo) >= now() - interval '90 days'
        ORDER BY lower(t.rango_tiempo) DESC
        LIMIT ${MAX_MIS_TURNOS}`,
      [usuarioId],
    );
    return filas.map((f) => ({
      id: f.id,
      inicio: new Date(f.inicio).toISOString(),
      fin: new Date(f.fin).toISOString(),
      estado: f.estado,
      bahia: f.bahiaNombre,
      servicio: { nombre: f.servicioNombre, categoria: f.servicioCategoria },
      tecnico: f.tecnicoNombre,
    }));
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
        // Desde 011 un cancelado no ocupa su horario: sugerirlo como
        // ocupado ocultaria un hueco que ahora si se puede reservar. Con
        // este predicado el planner puede usar el GiST parcial de la
        // constraint.
        estado: Not(EstadoTurno.CANCELADO),
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
