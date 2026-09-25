import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ContextoDb } from '@turnos-platform/tenant';
import { DataSource, Not, QueryFailedError, Raw, Repository } from 'typeorm';
import {
  buscarTecnico,
  buscarUsuario,
  esRolTecnico,
} from '../../common/tecnicos.util';
import {
  diaDelTaller,
  type HorarioTaller,
  limitesDelDia,
  MAX_DIAS_CALENDARIO_BUSQUEDA,
  minutosAHora,
} from '../../common/horario.util';
import {
  evaluarCancelacion,
  formatearAnticipacion,
  STRIKES_PARA_PREPAGO,
} from '../../common/politica-cancelacion.util';
import {
  calcularAnticipo,
  calcularPrecio,
  type Precio,
} from '../../common/precios.util';
import {
  fechaEnZona,
  horaEnZona,
  inicioDelDiaEnZona,
  sumarDiasFecha,
  zonaHorariaNegocio,
} from '../../common/zona-horaria.util';
import { Bahia } from '../../entities/bahia.entity';
import { EstadoTurno, Turno } from '../../entities/turno.entity';
import { HorarioService } from '../configuracion/horario.service';
import {
  type MotivoStrike,
  PoliticaService,
} from '../politica/politica.service';
import { ServiciosService } from '../servicios/servicios.service';
import { VehiculosService } from '../vehiculos/vehiculos.service';
import { ActualizarEstadoDto } from './dto/actualizar-estado.dto';
import {
  CancelarTurnoDto,
  FinalizarAtencionDto,
  ReprogramarTurnoDto,
  type SolicitadoPor,
} from './dto/ciclo-turno.dto';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { DisponibilidadQueryDto } from './dto/disponibilidad-query.dto';
import {
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
const ROL_SUPERADMIN = 'superadmin';
const ROL_CLIENTE = 'cliente';
const ROL_TECNICO = 'tecnico';

const ETIQUETA_ESTADO: Record<EstadoTurno, string> = {
  [EstadoTurno.PROGRAMADO]: 'programado',
  [EstadoTurno.ATENDIDO]: 'atendido',
  [EstadoTurno.NO_ASISTIO]: 'no asistio',
  [EstadoTurno.CANCELADO]: 'cancelado',
};

/** Lo que devuelven cancelar y reprogramar (Sprint 22). */
export interface ResultadoCambio {
  /** Cancelar: el turno cancelado. Reprogramar: el turno NUEVO. */
  turno: Turno;
  /** Se sumo un strike por hacerlo fuera de la ventana. */
  strike: boolean;
  /** Hasta cuando era gratis (instante). */
  gratisHasta: string;
}

/** El detalle que el cliente lee en su perfil, en hora del taller. */
function detalleTardio(
  accion: 'Cancelaste' | 'Reprogramaste',
  turno: Turno,
  evaluacion: { anticipacionMinutos: number; ventanaHoras: number },
): string {
  const zona = zonaHorariaNegocio();
  const inicio = turno.rangoTiempo.inicio;
  return (
    `${accion} el turno del ${fechaEnZona(inicio, zona)} a las ${horaEnZona(inicio, zona)} ` +
    `con ${formatearAnticipacion(evaluacion.anticipacionMinutos)} de anticipacion ` +
    `(sin strike: hasta ${evaluacion.ventanaHoras} h antes).`
  );
}

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
function validarHorarioReservable(
  inicio: Date,
  fin: Date,
  horario: HorarioTaller,
  zona: string,
): void {
  if (inicio.getTime() < Date.now()) {
    throw new BadRequestException(
      'No se puede reservar un turno en el pasado.',
    );
  }

  // Jornada del taller ESE dia (Sprint 21: horario por dia y festivos), la
  // misma que usan la grilla y sugerirHorarios: si estos criterios se
  // separan, el sistema sugiere horarios que despues rechaza. El instante
  // que manda el cliente puede venir con cualquier offset (Z, -05:00, ...):
  // lo que importa es a que dia y hora de pared del taller corresponde.
  const fecha = fechaEnZona(inicio, zona);
  const dia = diaDelTaller(horario, fecha);
  if (!dia.abierto) {
    throw new BadRequestException(
      dia.motivo === 'Cerrado'
        ? `El taller no atiende ese dia (${fecha}).`
        : `El taller no atiende el ${fecha} (${dia.motivo}).`,
    );
  }
  const { apertura, cierre } = limitesDelDia(fecha, dia.jornada, zona);
  if (inicio < apertura || fin > cierre) {
    throw new BadRequestException(
      `El turno debe quedar dentro del horario del taller ese dia (${minutosAHora(dia.jornada.apertura)}-${minutosAHora(dia.jornada.cierre)}, hora de ${zona}).`,
    );
  }
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
  tallerId: string | null;
  tallerNombre: string | null;
  baseCentavos: string | null;
  ivaCentavos: string | null;
  totalCentavos: string | null;
  tarifaIva: number | null;
  anticipoCentavos: string | null;
  anticipoPorStrikes: boolean;
  canceladoPor: 'cliente' | 'taller' | null;
  ventanaHoras: number | null;
  vehiculoId: string | null;
  placa: string | null;
  marca: string | null;
  modelo: string | null;
  recepcionId: string | null;
  recepcionNumero: number | null;
  recepcionAceptadaEn: Date | null;
  garantiaDias: number | null;
  garantiaHasta: string | null;
  bahiaId: string;
  servicioId: string;
  tecnicoId: string | null;
}

/** Precio con el que se tomo el turno (foto, Sprint 21). */
export interface PrecioTurno {
  baseCentavos: number;
  ivaCentavos: number;
  totalCentavos: number;
  /** null: el taller no era responsable de IVA al reservar. */
  tarifaIva: number | null;
}

export interface MiTurno {
  id: string;
  inicio: string;
  fin: string;
  estado: EstadoTurno;
  bahia: string;
  servicio: { nombre: string; categoria: string };
  tecnico: string | null;
  /** En que taller (Sprint 20: un cliente puede reservar en varios). */
  taller: { id: string; nombre: string } | null;
  /** null en turnos anteriores al Sprint 21. */
  precio: PrecioTurno | null;
  /** Sprint 22: lo que se paga por adelantado (100% con 3 strikes). */
  anticipo: { centavos: number; porStrikes: boolean } | null;
  vehiculo: { id: string; placa: string; marca: string; modelo: string } | null;
  /** Quien cancelo (null si no esta cancelado o es anterior al Sprint 22). */
  canceladoPor: 'cliente' | 'taller' | null;
  /**
   * Solo en un turno programado que no empezo: hasta cuando cancelarlo o
   * reprogramarlo es gratis (instante), con la ventana del SU taller.
   */
  cancelacion: { gratisHasta: string; ventanaHoras: number } | null;
  /** Constancia de recepcion: aceptada o esperando al cliente. */
  recepcion: { id: string; numero: number; aceptada: boolean } | null;
  /** Atendido: termino de garantia (null en dias = rige la legal). */
  garantia: { dias: number | null; hasta: string | null } | null;
  /** Para reprogramar con la misma bahia, servicio y tecnico. */
  ids: { bahia: string; servicio: string; tecnico: string | null };
}

export interface TurnoSinTecnico {
  id: string;
  inicio: string;
  fin: string;
  bahia: string;
  servicio: string;
  cliente: string | null;
}

export interface DisponibilidadResponse {
  fecha: string;
  zonaHoraria: string;
  duracionMinutos: number;
  /** null: el taller no atiende ese dia (ver cerrado). */
  jornada: { apertura: string; cierre: string } | null;
  /** Motivo si el taller no atiende ese dia ("Cerrado" o el festivo). */
  cerrado: string | null;
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
    private readonly db: ContextoDb,
    private readonly horarios: HorarioService,
    private readonly politica: PoliticaService,
    private readonly vehiculos: VehiculosService,
  ) {}

  // Repositorios del request (transaccion con RLS, Sprint 20); fuera de un
  // request, los inyectados (modo sistema y tests unitarios).
  private get turnos() {
    return this.db.repo(Turno, this.turnosRepository);
  }
  private get bahias() {
    return this.db.repo(Bahia, this.bahiasRepository);
  }
  private get sql() {
    return this.db.ejecutor(this.dataSource);
  }

  /**
   * Un recurso de OTRO taller se trata como inexistente (404), igual que
   * uno que no existe: no se confirma que el id sea valido en otro lado.
   * RLS ya lo oculta casi siempre; esto cubre lo que un cliente puede ver
   * de otros talleres por sus propios turnos (bahias y servicios usados).
   */
  private esDeOtroTaller(tallerDelRecurso: string | null | undefined): boolean {
    const taller = this.db.tallerActual();
    return taller !== null && tallerDelRecurso !== taller;
  }

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
    if (usuario.rol !== ROL_ADMIN && usuario.rol !== ROL_SUPERADMIN) {
      throw new ForbiddenException(
        'Solo un administrador puede reservar a nombre de otro usuario.',
      );
    }
    // RLS: solo aparecen los clientes relacionados con el taller (Sprint 20).
    const cliente = await buscarUsuario(this.sql, clienteId);
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
    const bahia = await this.bahias.findOne({
      where: { id: ids.bahiaId },
    });
    if (!bahia || !bahia.activa || this.esDeOtroTaller(bahia.tallerId)) {
      throw new NotFoundException(
        `Bahia ${ids.bahiaId} no encontrada o fuera de servicio`,
      );
    }

    const servicio = await this.serviciosService.findOne(ids.servicioId);
    if (!servicio.activo || this.esDeOtroTaller(servicio.tallerId)) {
      throw new NotFoundException(
        `Servicio ${ids.servicioId} no esta disponible`,
      );
    }

    const tecnico = await buscarTecnico(this.sql, ids.tecnicoId);
    // Uno dado de baja (Sprint 21) no recibe turnos nuevos.
    if (
      !tecnico ||
      !esRolTecnico(tecnico.rol) ||
      tecnico.activo === false ||
      this.esDeOtroTaller(tecnico.tallerId)
    ) {
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
    const horario = await this.horarios.obtener(fecha, fecha);
    const dia = diaDelTaller(horario, fecha);
    if (!dia.abierto) {
      return {
        fecha,
        zonaHoraria: zona,
        duracionMinutos: servicio.duracionMinutos,
        jornada: null,
        cerrado: dia.motivo,
        horarios: [],
      };
    }

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
    const ocupados = await this.turnos.find({
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
        apertura: minutosAHora(dia.jornada.apertura),
        cierre: minutosAHora(dia.jornada.cierre),
      },
      cerrado: null,
      horarios: horariosLibresDelDia({
        fecha,
        duracionMinutos: servicio.duracionMinutos,
        turnosOcupados: ocupados.map((t) => t.rangoTiempo),
        ahora: new Date(),
        zonaHoraria: zona,
        horario,
      }),
    };
  }

  async create(
    dto: CreateAppointmentDto,
    usuarioId: string,
    paraCliente = false,
    titularEsCliente = paraCliente,
    opciones: {
      /** Reprogramar conserva el precio con el que se tomo el turno. */
      precio?: Precio;
    } = {},
  ): Promise<Turno> {
    const tallerId = this.db.tallerActual();
    const { servicio } = await this.validarRecursos(dto);

    const inicio = new Date(dto.inicio);
    const fin = new Date(inicio.getTime() + servicio.duracionMinutos * 60_000);

    const zona = zonaHorariaNegocio();
    const fecha = fechaEnZona(inicio, zona);
    const horario = await this.horarios.obtener(fecha, fecha);
    validarHorarioReservable(inicio, fin, horario, zona);

    // El vehiculo tiene que ser del titular del turno: el admin que reserva
    // por un cliente no puede colgarle el carro de otro.
    if (dto.vehiculoId) {
      const vehiculo = await this.vehiculos.obtener(dto.vehiculoId);
      if (vehiculo.usuarioId !== usuarioId || !vehiculo.activo) {
        throw new BadRequestException(
          'El vehiculo no es del titular del turno o esta dado de baja.',
        );
      }
    }

    // Foto del precio (Sprint 21): el turno queda con el precio y el IVA de
    // HOY, aunque manana cambien el servicio o la configuracion fiscal.
    const precio =
      opciones.precio ??
      calcularPrecio(
        servicio.precioBaseCentavos,
        servicio.tarifaIva,
        await this.serviciosService.responsableIva(tallerId),
      );

    // Sprint 22: con 3 strikes vigentes EN ESTE TALLER, el cliente reserva
    // pagando el 100% por adelantado. Se marca aca (anticipo = total); el
    // cobro llega en el Sprint 24.
    const prepagoPorStrikes =
      tallerId !== null &&
      titularEsCliente &&
      (await this.politica.strikesVigentes(tallerId, usuarioId)) >=
        STRIKES_PARA_PREPAGO;
    const anticipo = prepagoPorStrikes
      ? precio.totalCentavos
      : servicio.requiereAnticipo
        ? calcularAnticipo(precio.totalCentavos, servicio.porcentajeAnticipo)
        : null;

    const turno = this.turnos.create({
      ...(tallerId ? { tallerId } : {}),
      bahiaId: dto.bahiaId,
      servicioId: dto.servicioId,
      tecnicoId: dto.tecnicoId,
      usuarioId,
      vehiculoId: dto.vehiculoId ?? null,
      rangoTiempo: { inicio, fin },
      precioBaseCentavos: precio.baseCentavos,
      ivaCentavos: precio.ivaCentavos,
      totalCentavos: precio.totalCentavos,
      tarifaIva: precio.tarifaIva,
      anticipoCentavos: anticipo,
      anticipoPorStrikes: prepagoPorStrikes,
    });

    try {
      // Savepoint: si el INSERT choca (23P01), la transaccion del request
      // sigue usable para buscar sugerencias (ver ContextoDb.conSavepoint).
      const guardado = await this.db.conSavepoint(() =>
        this.turnos.save(turno),
      );
      // El cliente queda relacionado con el taller donde reservo: desde ahi
      // el taller lo ve entre sus clientes (Sprint 20).
      if (tallerId && titularEsCliente) {
        await this.db.query(
          `INSERT INTO clientes_taller (taller_id, usuario_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [tallerId, usuarioId],
        );
      }
      return guardado;
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
          horario,
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
  async actualizarEstado(
    id: string,
    dto: ActualizarEstadoDto,
    usuario: { sub: string; rol: string } = { sub: '', rol: ROL_ADMIN },
  ): Promise<Turno> {
    const turno = await this.turnoDelPersonal(id, usuario);

    // Sprint 22: el tecnico cierra SUS turnos pendientes, como atendido o
    // no asistio. Corregir un cierre (y con eso anular o no un strike) o
    // cancelar es del admin.
    if (usuario.rol === ROL_TECNICO) {
      if (turno.estado !== EstadoTurno.PROGRAMADO) {
        throw new ForbiddenException(
          'El turno ya esta cerrado. Para corregirlo, pedile al administrador.',
        );
      }
      if (
        dto.estado !== EstadoTurno.ATENDIDO &&
        dto.estado !== EstadoTurno.NO_ASISTIO
      ) {
        throw new ForbiddenException(
          'El tecnico cierra el turno como atendido o no asistio; cancelar es del administrador.',
        );
      }
    }

    // Reactivar el turno viejo de una reprogramacion dejaria al cliente con
    // dos turnos por el mismo servicio.
    if (
      turno.estado === EstadoTurno.CANCELADO &&
      turno.reprogramadoA &&
      dto.estado !== EstadoTurno.CANCELADO
    ) {
      throw new ConflictException(
        'Ese turno se reprogramo: el vigente es el nuevo. Reactivarlo lo duplicaria.',
      );
    }

    // No asistio es un hecho, no una prediccion: antes de la hora del turno
    // el cliente todavia puede llegar. Y suma un strike.
    if (
      dto.estado === EstadoTurno.NO_ASISTIO &&
      turno.estado !== EstadoTurno.NO_ASISTIO &&
      turno.rangoTiempo.inicio.getTime() > Date.now()
    ) {
      throw new BadRequestException(
        'Todavia no es la hora del turno: no se puede marcar que no asistio.',
      );
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
    if (dto.notas !== undefined) turno.notasAtencion = dto.notas.trim() || null;

    // Cancelar por esta via es siempre del taller: nunca suma strike.
    if (dto.estado === EstadoTurno.CANCELADO) {
      if (estadoAnterior !== EstadoTurno.CANCELADO) {
        turno.canceladoPor = 'taller';
        turno.canceladoEn = new Date();
        turno.motivoCancelacion =
          dto.motivo?.trim() || 'Cancelado por el taller';
      }
    } else {
      // Reactivado: los datos de la cancelacion ya no aplican (017 lo exige).
      turno.canceladoPor = null;
      turno.canceladoEn = null;
      turno.motivoCancelacion = null;
      turno.reprogramadoA = null;
    }

    // Garantia (Decreto 735 de 2013): foto del termino del servicio al
    // cerrar como atendido, contada desde el dia de entrega.
    if (esAtendido) {
      const servicio = turno.servicioId
        ? await this.serviciosService.findOne(turno.servicioId)
        : null;
      const dias = servicio?.garantiaDias ?? null;
      turno.garantiaDias = dias;
      turno.garantiaHasta =
        dias === null
          ? null
          : sumarDiasFecha(
              fechaEnZona(atencionFin ?? new Date(), zonaHorariaNegocio()),
              dias,
            );
    } else {
      turno.garantiaDias = null;
      turno.garantiaHasta = null;
    }

    let guardado: Turno;
    try {
      guardado = await this.db.conSavepoint(() => this.turnos.save(turno));
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

    // Strikes (Sprint 22). El taller que cancela o no atiende nunca suma:
    // solo el no-show del CLIENTE. Corregir un no asistio anula su strike.
    if (
      dto.estado === EstadoTurno.NO_ASISTIO &&
      estadoAnterior !== EstadoTurno.NO_ASISTIO
    ) {
      await this.strikeSiEsCliente(turno, 'no_asistio', () => {
        const zona = zonaHorariaNegocio();
        return `No asististe al turno del ${fechaEnZona(turno.rangoTiempo.inicio, zona)} a las ${horaEnZona(turno.rangoTiempo.inicio, zona)}.`;
      });
    } else if (
      estadoAnterior === EstadoTurno.NO_ASISTIO &&
      dto.estado !== EstadoTurno.NO_ASISTIO
    ) {
      await this.politica.anularPorCorreccion(
        turno.id,
        usuario.sub,
        `El taller corrigio el cierre del turno: quedo como ${ETIQUETA_ESTADO[dto.estado]}.`,
      );
    }
    return guardado;
  }

  /**
   * El turno, si es del taller de la sesion y (para un tecnico) esta
   * asignado a el. 404 en cualquier otro caso: no se confirma que exista.
   */
  private async turnoDelPersonal(
    id: string,
    usuario: { sub: string; rol: string },
  ): Promise<Turno> {
    const turno = await this.turnos.findOne({ where: { id } });
    // Un turno de otro taller no existe para este request (RLS lo oculta
    // salvo que sea del propio usuario; el cierre es del personal del taller).
    if (
      !turno ||
      this.esDeOtroTaller(turno.tallerId) ||
      (usuario.rol === ROL_TECNICO && turno.tecnicoId !== usuario.sub)
    ) {
      throw new NotFoundException(`Turno ${id} no encontrado`);
    }
    return turno;
  }

  /** Strike al titular, si es un cliente (no a un admin que se reservo). */
  private async strikeSiEsCliente(
    turno: Turno,
    motivo: MotivoStrike,
    detalle: () => string,
  ): Promise<boolean> {
    if (!turno.usuarioId) return false;
    const titular = await buscarUsuario(this.sql, turno.usuarioId);
    if (titular?.rol !== ROL_CLIENTE) return false;
    const id = await this.politica.registrarStrike({
      tallerId: turno.tallerId,
      usuarioId: turno.usuarioId,
      turnoId: turno.id,
      motivo,
      detalle: detalle(),
    });
    return id !== null;
  }

  // ------------------------------------------------ cancelar y reprogramar

  /**
   * El turno que el usuario puede cancelar o reprogramar: el cliente, uno
   * propio; el admin, cualquiera del taller. Tiene que seguir programado.
   */
  private async turnoCancelable(
    id: string,
    usuario: { sub: string; rol: string },
  ): Promise<Turno> {
    const turno = await this.turnos.findOne({ where: { id } });
    const esCliente = usuario.rol === ROL_CLIENTE;
    if (
      !turno ||
      (esCliente && turno.usuarioId !== usuario.sub) ||
      (!esCliente && this.esDeOtroTaller(turno.tallerId))
    ) {
      throw new NotFoundException(`Turno ${id} no encontrado`);
    }
    // El cliente puede ver turnos propios de cualquier taller, pero
    // modificar solo en el de la sesion (RLS de 015): X-Taller del turno.
    if (esCliente && this.esDeOtroTaller(turno.tallerId)) {
      throw new BadRequestException(
        'Ese turno es de otro taller: elegi ese taller para modificarlo.',
      );
    }
    if (turno.estado !== EstadoTurno.PROGRAMADO) {
      throw new BadRequestException(
        `El turno ya esta ${ETIQUETA_ESTADO[turno.estado]}.`,
      );
    }
    // Empezado, el cliente ya no cancela: si no vino, es un no asistio (lo
    // cierra el taller). El taller si puede cancelar uno que no pudo atender.
    if (esCliente && turno.rangoTiempo.inicio.getTime() <= Date.now()) {
      throw new BadRequestException(
        'El turno ya empezo: no se puede cancelar ni reprogramar.',
      );
    }
    return turno;
  }

  /** Quien pidio el cambio: el cliente logueado siempre es 'cliente'. */
  private quienPide(
    usuario: { rol: string },
    solicitadoPor?: SolicitadoPor,
  ): SolicitadoPor {
    return usuario.rol === ROL_CLIENTE
      ? 'cliente'
      : (solicitadoPor ?? 'taller');
  }

  /**
   * Politica aplicada a un cambio del cliente: gratis dentro de la ventana
   * del taller, strike fuera de ella. Hora del taller en el detalle.
   */
  private async evaluarCambio(turno: Turno) {
    const { ventanaHoras } = await this.politica.obtener(turno.tallerId);
    return {
      ventanaHoras,
      ...evaluarCancelacion({
        inicioTurno: turno.rangoTiempo.inicio,
        ahora: new Date(),
        ventanaHoras,
        zona: zonaHorariaNegocio(),
      }),
    };
  }

  async cancelar(
    id: string,
    dto: CancelarTurnoDto,
    usuario: { sub: string; rol: string },
  ): Promise<ResultadoCambio> {
    const turno = await this.turnoCancelable(id, usuario);
    const quien = this.quienPide(usuario, dto.solicitadoPor);
    const evaluacion = await this.evaluarCambio(turno);

    turno.estado = EstadoTurno.CANCELADO;
    turno.canceladoPor = quien;
    turno.canceladoEn = new Date();
    turno.motivoCancelacion =
      dto.motivo?.trim() ||
      (quien === 'cliente'
        ? 'Cancelado por el cliente'
        : 'Cancelado por el taller');
    const guardado = await this.turnos.save(turno);

    const strike =
      quien === 'cliente' && !evaluacion.gratis
        ? await this.strikeSiEsCliente(turno, 'cancelacion_tardia', () =>
            detalleTardio('Cancelaste', turno, evaluacion),
          )
        : false;
    return {
      turno: guardado,
      strike,
      gratisHasta: evaluacion.limite.toISOString(),
    };
  }

  /**
   * Reprogramar = cancelar este turno y tomar otro, con el mismo servicio,
   * vehiculo y precio. Todo en la transaccion del request: si el horario
   * nuevo choca (409 con sugerencias), el turno original queda como estaba
   * y el strike no se registra.
   */
  async reprogramar(
    id: string,
    dto: ReprogramarTurnoDto,
    usuario: { sub: string; rol: string },
  ): Promise<ResultadoCambio> {
    const original = await this.turnoCancelable(id, usuario);
    const quien = this.quienPide(usuario, dto.solicitadoPor);
    const tecnicoId = dto.tecnicoId ?? original.tecnicoId;
    if (!tecnicoId) {
      throw new BadRequestException(
        'El turno no tiene tecnico: indica con quien (tecnicoId).',
      );
    }
    if (!original.servicioId || !original.usuarioId) {
      throw new BadRequestException('Ese turno no se puede reprogramar.');
    }
    if (
      new Date(dto.inicio).getTime() ===
        original.rangoTiempo.inicio.getTime() &&
      (dto.bahiaId ?? original.bahiaId) === original.bahiaId &&
      tecnicoId === original.tecnicoId
    ) {
      throw new BadRequestException('Es el mismo horario que ya tenes.');
    }
    const evaluacion = await this.evaluarCambio(original);

    // Primero se libera el horario original: el nuevo puede solaparse con
    // el (correrlo media hora) y las EXCLUDE lo tomarian como choque.
    original.estado = EstadoTurno.CANCELADO;
    original.canceladoPor = quien;
    original.canceladoEn = new Date();
    original.motivoCancelacion = 'Reprogramado';
    await this.turnos.save(original);

    // El strike antes de crear el nuevo: si con este llega a 3, el turno
    // nuevo ya sale con pago total por adelantado.
    const strike =
      quien === 'cliente' && !evaluacion.gratis
        ? await this.strikeSiEsCliente(original, 'reprogramacion_tardia', () =>
            detalleTardio('Reprogramaste', original, evaluacion),
          )
        : false;

    const titular = await buscarUsuario(this.sql, original.usuarioId);
    const nuevo = await this.create(
      {
        bahiaId: dto.bahiaId ?? original.bahiaId,
        servicioId: original.servicioId,
        tecnicoId,
        inicio: dto.inicio,
        vehiculoId: original.vehiculoId ?? undefined,
      },
      original.usuarioId,
      usuario.rol !== ROL_CLIENTE,
      titular?.rol === ROL_CLIENTE,
      {
        precio:
          original.totalCentavos == null
            ? undefined
            : {
                baseCentavos: original.precioBaseCentavos ?? 0,
                ivaCentavos: original.ivaCentavos ?? 0,
                totalCentavos: original.totalCentavos,
                tarifaIva: (original.tarifaIva ?? null) as Precio['tarifaIva'],
              },
      },
    );

    original.reprogramadoA = nuevo.id;
    await this.turnos.save(original);
    return {
      turno: nuevo,
      strike,
      gratisHasta: evaluacion.limite.toISOString(),
    };
  }

  // ------------------------------------------------------------- atencion

  /** El tecnico marca que empezo a trabajar en el vehiculo. */
  async iniciarAtencion(
    id: string,
    usuario: { sub: string; rol: string },
  ): Promise<Turno> {
    const turno = await this.turnoDelPersonal(id, usuario);
    if (turno.estado !== EstadoTurno.PROGRAMADO) {
      throw new BadRequestException(
        `El turno esta ${ETIQUETA_ESTADO[turno.estado]}: no se puede iniciar.`,
      );
    }
    if (turno.atencionInicio) {
      throw new ConflictException('La atencion ya estaba iniciada.');
    }
    // El carro puede llegar antes de la hora, pero no otro dia.
    const zona = zonaHorariaNegocio();
    if (
      fechaEnZona(new Date(), zona) <
      fechaEnZona(turno.rangoTiempo.inicio, zona)
    ) {
      throw new BadRequestException(
        'El turno es de otro dia: la atencion se inicia el dia del turno.',
      );
    }
    turno.atencionInicio = new Date();
    return this.turnos.save(turno);
  }

  async finalizarAtencion(
    id: string,
    dto: FinalizarAtencionDto,
    usuario: { sub: string; rol: string },
  ): Promise<Turno> {
    const turno = await this.turnoDelPersonal(id, usuario);
    if (turno.estado !== EstadoTurno.PROGRAMADO) {
      throw new BadRequestException(
        `El turno esta ${ETIQUETA_ESTADO[turno.estado]}: no se puede finalizar.`,
      );
    }
    if (!turno.atencionInicio) {
      throw new BadRequestException('Primero hay que iniciar la atencion.');
    }
    if (turno.atencionFin) {
      throw new ConflictException('La atencion ya estaba finalizada.');
    }
    const fin = new Date();
    // turnos_atencion_rango_check (009) exige fin > inicio estricto.
    turno.atencionFin =
      fin > turno.atencionInicio
        ? fin
        : new Date(turno.atencionInicio.getTime() + 1000);
    if (dto.notas !== undefined) turno.notasAtencion = dto.notas.trim() || null;
    return this.turnos.save(turno);
  }

  async actualizarNotas(
    id: string,
    notas: string,
    usuario: { sub: string; rol: string },
  ): Promise<Turno> {
    const turno = await this.turnoDelPersonal(id, usuario);
    // Una orden cerrada ya se entrego con esas notas; corregirla es del admin.
    if (
      usuario.rol === ROL_TECNICO &&
      turno.estado !== EstadoTurno.PROGRAMADO
    ) {
      throw new ForbiddenException(
        'El turno ya esta cerrado. Para corregir las notas, pedile al administrador.',
      );
    }
    turno.notasAtencion = notas.trim() || null;
    return this.turnos.save(turno);
  }

  /**
   * Turnos del propio usuario (Sprint 18, "Mis turnos" del cliente): los
   * que vienen y los ultimos 90 dias. Nombre del tecnico por SQL crudo,
   * igual que el detalle de bahia (usuarios es tabla de usuarios-service).
   */
  async misTurnos(usuarioId: string): Promise<MiTurno[]> {
    // Sin filtro de taller: RLS deja ver los turnos propios de cualquier
    // taller, y bahias/servicios/tecnicos de esos turnos (migracion 015).
    const filas: FilaMiTurno[] = await this.sql.query(
      `SELECT t.id,
              lower(t.rango_tiempo) AS inicio,
              upper(t.rango_tiempo) AS fin,
              t.estado,
              b.nombre             AS "bahiaNombre",
              s.nombre             AS "servicioNombre",
              s.categoria          AS "servicioCategoria",
              tec.nombre           AS "tecnicoNombre",
              ta.id                AS "tallerId",
              ta.nombre            AS "tallerNombre",
              t.precio_base_centavos AS "baseCentavos",
              t.iva_centavos       AS "ivaCentavos",
              t.total_centavos     AS "totalCentavos",
              t.tarifa_iva         AS "tarifaIva",
              t.anticipo_centavos  AS "anticipoCentavos",
              t.anticipo_por_strikes AS "anticipoPorStrikes",
              t.cancelado_por      AS "canceladoPor",
              p.ventana_horas      AS "ventanaHoras",
              v.id                 AS "vehiculoId",
              v.placa, v.marca, v.modelo,
              r.id                 AS "recepcionId",
              r.numero             AS "recepcionNumero",
              r.aceptada_en        AS "recepcionAceptadaEn",
              t.garantia_dias      AS "garantiaDias",
              to_char(t.garantia_hasta, 'YYYY-MM-DD') AS "garantiaHasta",
              t.bahia_id           AS "bahiaId",
              t.servicio_id        AS "servicioId",
              t.tecnico_id         AS "tecnicoId"
         FROM turnos t
         JOIN bahias b    ON b.id = t.bahia_id
         JOIN servicios s ON s.id = t.servicio_id
         LEFT JOIN usuarios tec ON tec.id = t.tecnico_id
         LEFT JOIN talleres ta  ON ta.id = t.taller_id
         LEFT JOIN politica_cancelacion p ON p.taller_id = t.taller_id
         LEFT JOIN vehiculos v  ON v.id = t.vehiculo_id
         LEFT JOIN recepciones r ON r.turno_id = t.id
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
      taller: f.tallerId
        ? { id: f.tallerId, nombre: f.tallerNombre ?? '' }
        : null,
      precio:
        f.totalCentavos === null
          ? null
          : {
              baseCentavos: Number(f.baseCentavos),
              ivaCentavos: Number(f.ivaCentavos),
              totalCentavos: Number(f.totalCentavos),
              tarifaIva: f.tarifaIva,
            },
      anticipo:
        f.anticipoCentavos === null
          ? null
          : {
              centavos: Number(f.anticipoCentavos),
              porStrikes: f.anticipoPorStrikes,
            },
      vehiculo: f.vehiculoId
        ? {
            id: f.vehiculoId,
            placa: f.placa ?? '',
            marca: f.marca ?? '',
            modelo: f.modelo ?? '',
          }
        : null,
      canceladoPor: f.canceladoPor,
      cancelacion:
        f.estado === EstadoTurno.PROGRAMADO &&
        new Date(f.inicio).getTime() > Date.now()
          ? {
              ventanaHoras: f.ventanaHoras ?? 4,
              // La misma regla que aplica cancelar(): lo que se muestra es
              // lo que despues se cobra.
              gratisHasta: evaluarCancelacion({
                inicioTurno: new Date(f.inicio),
                ahora: new Date(),
                ventanaHoras: f.ventanaHoras ?? 4,
                zona: zonaHorariaNegocio(),
              }).limite.toISOString(),
            }
          : null,
      recepcion: f.recepcionId
        ? {
            id: f.recepcionId,
            numero: Number(f.recepcionNumero),
            aceptada: f.recepcionAceptadaEn !== null,
          }
        : null,
      garantia:
        f.estado === EstadoTurno.ATENDIDO
          ? { dias: f.garantiaDias, hasta: f.garantiaHasta }
          : null,
      ids: { bahia: f.bahiaId, servicio: f.servicioId, tecnico: f.tecnicoId },
    }));
  }

  /**
   * Turnos que vienen y quedaron sin tecnico (el suyo se dio de baja,
   * Sprint 21): lo que el panel muestra para reasignar.
   */
  async sinTecnico(): Promise<TurnoSinTecnico[]> {
    const taller = this.db.exigirTaller();
    const filas: {
      id: string;
      inicio: Date;
      fin: Date;
      bahia: string;
      servicio: string;
      cliente: string | null;
    }[] = await this.sql.query(
      `SELECT t.id,
              lower(t.rango_tiempo) AS inicio,
              upper(t.rango_tiempo) AS fin,
              b.nombre AS bahia,
              s.nombre AS servicio,
              cli.nombre AS cliente
         FROM turnos t
         JOIN bahias b    ON b.id = t.bahia_id
         JOIN servicios s ON s.id = t.servicio_id
         LEFT JOIN usuarios cli ON cli.id = t.usuario_id
        WHERE t.taller_id = $1
          AND t.tecnico_id IS NULL
          AND t.estado = 'programado'
          AND lower(t.rango_tiempo) > now()
        ORDER BY lower(t.rango_tiempo)`,
      [taller],
    );
    return filas.map((f) => ({
      ...f,
      inicio: new Date(f.inicio).toISOString(),
      fin: new Date(f.fin).toISOString(),
    }));
  }

  /** Asigna (o cambia) el tecnico de un turno que viene. */
  async reasignarTecnico(id: string, tecnicoId: string): Promise<Turno> {
    const turno = await this.turnos.findOne({ where: { id } });
    if (!turno || this.esDeOtroTaller(turno.tallerId)) {
      throw new NotFoundException(`Turno ${id} no encontrado`);
    }
    if (
      turno.estado !== EstadoTurno.PROGRAMADO ||
      turno.rangoTiempo.inicio.getTime() <= Date.now()
    ) {
      throw new BadRequestException(
        'Solo se puede reasignar un turno programado que todavia no empezo.',
      );
    }
    const tecnico = await buscarTecnico(this.sql, tecnicoId);
    if (
      !tecnico ||
      !esRolTecnico(tecnico.rol) ||
      tecnico.activo === false ||
      this.esDeOtroTaller(tecnico.tallerId)
    ) {
      throw new NotFoundException(
        `Tecnico ${tecnicoId} no encontrado o dado de baja`,
      );
    }
    turno.tecnicoId = tecnicoId;
    try {
      return await this.db.conSavepoint(() => this.turnos.save(turno));
    } catch (error) {
      if (esErrorDeSolapamiento(error)) {
        throw new ConflictException(
          'El tecnico ya tiene otro turno en ese horario.',
        );
      }
      throw error;
    }
  }

  private async buscarSugerencias(
    filtro: FiltroRecurso,
    duracionMinutos: number,
    inicioSolicitado: Date,
    horario: HorarioTaller,
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
    // Hasta el tope de dias calendario que puede recorrer sugerirHorarios
    // para juntar sus dias de atencion (Sprint 21: se saltea cerrados y
    // festivos). Sobra en la semana normal, pero la ventana sigue acotada.
    const hasta = inicioDelDiaEnZona(
      sumarDiasFecha(fecha, MAX_DIAS_CALENDARIO_BUSQUEDA),
      zona,
    );
    // Los festivos de toda la ventana, no solo los del dia pedido.
    const horarioVentana = await this.horarios.obtener(
      fecha,
      sumarDiasFecha(fecha, MAX_DIAS_CALENDARIO_BUSQUEDA),
    );

    const turnosOcupados = await this.turnos.find({
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
      horario: { semana: horario.semana, feriados: horarioVentana.feriados },
    });
  }
}
