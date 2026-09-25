import { ContextoDb, DATA_SOURCE_TENANT } from '@turnos-platform/tenant';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { Bahia } from '../../entities/bahia.entity';
import { EstadoTurno, Turno } from '../../entities/turno.entity';
import {
  CategoriaServicio,
  Servicio,
} from '../servicios/entities/servicio.entity';
import { ServiciosService } from '../servicios/servicios.service';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';

function crearQueryFailedError(overrides: Record<string, unknown>) {
  return new QueryFailedError('INSERT INTO turnos ...', [], {
    code: '23P01',
    message: 'exclusion violation',
    ...overrides,
  } as any);
}

describe('AppointmentsService', () => {
  let service: AppointmentsService;
  let turnosRepository: jest.Mocked<Repository<Turno>>;
  let bahiasRepository: jest.Mocked<Repository<Bahia>>;
  let serviciosService: jest.Mocked<ServiciosService>;
  let dataSource: jest.Mocked<DataSource>;

  const bahia: Bahia = {
    id: 'b-1',
    tallerId: 'taller-1',
    nombre: 'Bahia 1',
    activa: true,
    creadoEn: new Date(),
    actualizadoEn: new Date(),
  };

  const servicio: Servicio = {
    id: 's-1',
    tallerId: 'taller-1',
    nombre: 'Cambio de aceite',
    categoria: CategoriaServicio.MECANICA,
    duracionMinutos: 30,
    precio: 25000,
    activo: true,
    creadoEn: new Date(),
    actualizadoEn: new Date(),
  };

  // Fecha relativa y no fija: desde Sprint 9 create() rechaza reservas en
  // el pasado, asi que una fecha literal de 2024 haria que estos tests
  // empezaran a fallar con el correr del calendario.
  //
  // Hora de pared de Bogota (zona de negocio por defecto, UTC-5 fijo) con el
  // offset escrito a mano, sin pasar por zona-horaria.util: asi el test no
  // valida el codigo con el mismo codigo.
  function horaLocalBogota(hora: number, minuto = 0, diasAdelante = 2): string {
    const hoyBogota = new Date(Date.now() - 5 * 3_600_000);
    hoyBogota.setUTCDate(hoyBogota.getUTCDate() + diasAdelante);
    const fecha = hoyBogota.toISOString().slice(0, 10);
    const hh = String(hora).padStart(2, '0');
    const mm = String(minuto).padStart(2, '0');
    return `${fecha}T${hh}:${mm}:00-05:00`;
  }

  const inicioValido = new Date(horaLocalBogota(9));

  const dto: CreateAppointmentDto = {
    bahiaId: bahia.id,
    servicioId: servicio.id,
    tecnicoId: 't-1',
    inicio: inicioValido.toISOString(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentsService,
        // Fuera de un request: modo sistema, usa los mocks de abajo.
        ContextoDb,
        { provide: DATA_SOURCE_TENANT, useExisting: DataSource },
        {
          provide: getRepositoryToken(Turno),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Bahia),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: ServiciosService,
          useValue: { findOne: jest.fn() },
        },
        {
          provide: DataSource,
          useValue: { query: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<AppointmentsService>(AppointmentsService);
    turnosRepository = module.get(getRepositoryToken(Turno));
    bahiasRepository = module.get(getRepositoryToken(Bahia));
    serviciosService = module.get(ServiciosService);
    dataSource = module.get(DataSource);

    bahiasRepository.findOne.mockResolvedValue(bahia);
    serviciosService.findOne.mockResolvedValue(servicio);
    dataSource.query.mockResolvedValue([{ id: 't-1', rol: 'tecnico' }]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('crea un turno cuando bahia, servicio y tecnico existen y no hay conflicto', async () => {
    const turnoCreado = { id: 'turno-1' } as Turno;
    turnosRepository.create.mockReturnValue(turnoCreado);
    turnosRepository.save.mockResolvedValue(turnoCreado);

    await expect(service.create(dto, 'u-1')).resolves.toEqual(turnoCreado);

    expect(turnosRepository.create).toHaveBeenCalledWith({
      bahiaId: dto.bahiaId,
      servicioId: dto.servicioId,
      tecnicoId: dto.tecnicoId,
      usuarioId: 'u-1',
      rangoTiempo: {
        inicio: inicioValido,
        fin: new Date(
          inicioValido.getTime() + servicio.duracionMinutos * 60_000,
        ),
      },
    });
  });

  it('lanza NotFoundException si la bahia no existe', async () => {
    bahiasRepository.findOne.mockResolvedValue(null);

    await expect(service.create(dto, 'u-1')).rejects.toThrow(NotFoundException);
    expect(serviciosService.findOne).not.toHaveBeenCalled();
  });

  it('propaga el NotFoundException del servicio inexistente', async () => {
    serviciosService.findOne.mockRejectedValue(
      new NotFoundException('Servicio no encontrado'),
    );

    await expect(service.create(dto, 'u-1')).rejects.toThrow(NotFoundException);
  });

  it('lanza NotFoundException si el tecnico no existe', async () => {
    dataSource.query.mockResolvedValue([]);

    await expect(service.create(dto, 'u-1')).rejects.toThrow(NotFoundException);
    expect(turnosRepository.save).not.toHaveBeenCalled();
  });

  it('lanza NotFoundException si el usuario existe pero no tiene rol de tecnico', async () => {
    dataSource.query.mockResolvedValue([{ id: 't-1', rol: 'cliente' }]);

    await expect(service.create(dto, 'u-1')).rejects.toThrow(NotFoundException);
    expect(turnosRepository.save).not.toHaveBeenCalled();
  });

  it('lanza ConflictException de bahia cuando la constraint violada es la de bahia', async () => {
    turnosRepository.create.mockReturnValue({} as Turno);
    turnosRepository.save.mockRejectedValue(
      crearQueryFailedError({ constraint: 'turnos_bahia_rango_excl' }),
    );
    turnosRepository.find.mockResolvedValue([]);

    const error = await service.create(dto, 'u-1').catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    const response = error.getResponse();
    expect(response.message).toMatch(/bahia/i);
    expect(turnosRepository.find).toHaveBeenCalledWith({
      where: expect.objectContaining({
        bahiaId: dto.bahiaId,
        // La condicion de rango acota la consulta a los dias que
        // sugerirHorarios va a explorar, en vez de traer todo el historico
        // de la bahia (ver buscarSugerencias).
        rangoTiempo: expect.anything(),
      }),
    });
    expect(Array.isArray(response.sugerencias)).toBe(true);
  });

  it('lanza ConflictException de tecnico cuando la constraint violada es la de tecnico', async () => {
    turnosRepository.create.mockReturnValue({} as Turno);
    turnosRepository.save.mockRejectedValue(
      crearQueryFailedError({ constraint: 'turnos_tecnico_rango_excl' }),
    );
    turnosRepository.find.mockResolvedValue([]);

    const error = await service.create(dto, 'u-1').catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    const response = error.getResponse();
    expect(response.message).toMatch(/tecnico/i);
    expect(turnosRepository.find).toHaveBeenCalledWith({
      where: expect.objectContaining({
        tecnicoId: dto.tecnicoId,
        rangoTiempo: expect.anything(),
      }),
    });
    expect(Array.isArray(response.sugerencias)).toBe(true);
  });

  describe('validacion de horario (Sprint 9, zona de negocio desde Sprint 12)', () => {
    const zonaOriginal = process.env.TZ_NEGOCIO;

    afterEach(() => {
      if (zonaOriginal === undefined) {
        delete process.env.TZ_NEGOCIO;
      } else {
        process.env.TZ_NEGOCIO = zonaOriginal;
      }
    });

    function aceptaGuardar() {
      turnosRepository.create.mockReturnValue({ id: 'turno-1' } as Turno);
      turnosRepository.save.mockResolvedValue({ id: 'turno-1' } as Turno);
    }

    it('rechaza una reserva en el pasado', async () => {
      await expect(
        service.create({ ...dto, inicio: '2019-01-01T09:00:00.000Z' }, 'u-1'),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(turnosRepository.save).not.toHaveBeenCalled();
    });

    it('rechaza una reserva antes de la apertura', async () => {
      await expect(
        service.create({ ...dto, inicio: horaLocalBogota(3) }, 'u-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza una reserva que termina despues del cierre', async () => {
      // 17:45 + 30 min de servicio = 18:15, fuera de la ventana. El motor de
      // sugerencias nunca ofreceria ese horario: si create() lo aceptara,
      // se podria entrar por la puerta de adelante a algo que el sistema
      // considera inreservable.
      await expect(
        service.create({ ...dto, inicio: horaLocalBogota(17, 45) }, 'u-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('acepta una reserva que termina justo al cierre', async () => {
      aceptaGuardar();

      await expect(
        service.create({ ...dto, inicio: horaLocalBogota(17, 30) }, 'u-1'),
      ).resolves.toEqual({ id: 'turno-1' });
    });

    it('acepta las 14:00 locales aunque lleguen expresadas en UTC', async () => {
      // 14:00 en Bogota = 19:00Z. Es el caso que el navegador manda con
      // toISOString(): la hora de pared la define la zona, no el sufijo.
      aceptaGuardar();
      const inicio = new Date(horaLocalBogota(14)).toISOString();

      await expect(service.create({ ...dto, inicio }, 'u-1')).resolves.toEqual({
        id: 'turno-1',
      });
    });

    it('rechaza las 07:45 locales aunque en UTC (12:45Z) parezcan horario laboral', async () => {
      await expect(
        service.create({ ...dto, inicio: horaLocalBogota(7, 45) }, 'u-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza un turno que cruza la medianoche local', async () => {
      // 23:45 + 30 min = 00:15 del dia siguiente en Bogota (04:45Z-05:15Z,
      // mismo dia UTC: con el criterio anterior no se detectaba el cruce).
      await expect(
        service.create({ ...dto, inicio: horaLocalBogota(23, 45) }, 'u-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza las 00:00 locales en punto', async () => {
      await expect(
        service.create({ ...dto, inicio: horaLocalBogota(0, 0) }, 'u-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('nombra la zona en el mensaje de error', async () => {
      const error = await service
        .create({ ...dto, inicio: horaLocalBogota(3) }, 'u-1')
        .catch((e: BadRequestException) => e);

      expect((error as BadRequestException).message).toContain(
        'America/Bogota',
      );
    });

    it('respeta TZ_NEGOCIO configurada', async () => {
      process.env.TZ_NEGOCIO = 'Asia/Tokyo'; // UTC+9
      aceptaGuardar();

      // 09:00 en Tokio = 00:00Z: invalido en Bogota, valido en Tokio.
      const hoyTokio = new Date(Date.now() + 9 * 3_600_000);
      hoyTokio.setUTCDate(hoyTokio.getUTCDate() + 2);
      const inicio = `${hoyTokio.toISOString().slice(0, 10)}T09:00:00+09:00`;

      await expect(service.create({ ...dto, inicio }, 'u-1')).resolves.toEqual({
        id: 'turno-1',
      });
    });
  });

  it('lanza ConflictException de cliente cuando la constraint violada es la de usuario', async () => {
    turnosRepository.create.mockReturnValue({} as Turno);
    turnosRepository.save.mockRejectedValue(
      crearQueryFailedError({ constraint: 'turnos_usuario_rango_excl' }),
    );
    turnosRepository.find.mockResolvedValue([]);

    const error = await service.create(dto, 'u-1').catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    const response = error.getResponse();
    expect(response.message).toMatch(/ya tenes otro turno/i);
    // Las alternativas se buscan sobre la agenda DEL CLIENTE: sugerir
    // huecos de la bahia cuando el ocupado es el cliente devolveria
    // horarios que vuelven a dar 409.
    const argumentos = turnosRepository.find.mock.calls[0]?.[0];
    expect(argumentos?.where).toEqual(
      expect.objectContaining({ usuarioId: 'u-1' }),
    );
  });

  it('repropaga errores que no son de solapamiento sin modificarlos', async () => {
    turnosRepository.create.mockReturnValue({} as Turno);
    const otroError = new Error('conexion perdida');
    turnosRepository.save.mockRejectedValue(otroError);

    await expect(service.create(dto, 'u-1')).rejects.toBe(otroError);
  });

  describe('actualizarEstado (RF-04)', () => {
    function turnoProgramado(): Turno {
      return {
        id: 'turno-1',
        estado: EstadoTurno.PROGRAMADO,
        atencionInicio: null,
        atencionFin: null,
      } as Turno;
    }

    beforeEach(() => {
      turnosRepository.save.mockImplementation(async (turno) => turno as Turno);
    });

    it('marca el turno como atendido y guarda las horas reales', async () => {
      turnosRepository.findOne.mockResolvedValue(turnoProgramado());

      const resultado = await service.actualizarEstado('turno-1', {
        estado: EstadoTurno.ATENDIDO,
        atencionInicio: '2024-01-08T09:05:00.000Z',
        atencionFin: '2024-01-08T09:47:00.000Z',
      });

      expect(resultado.estado).toBe(EstadoTurno.ATENDIDO);
      expect(resultado.atencionInicio).toEqual(
        new Date('2024-01-08T09:05:00.000Z'),
      );
      expect(resultado.atencionFin).toEqual(
        new Date('2024-01-08T09:47:00.000Z'),
      );
    });

    it('permite cerrar como atendido sin haber cronometrado', async () => {
      turnosRepository.findOne.mockResolvedValue(turnoProgramado());

      const resultado = await service.actualizarEstado('turno-1', {
        estado: EstadoTurno.ATENDIDO,
      });

      expect(resultado.estado).toBe(EstadoTurno.ATENDIDO);
      expect(resultado.atencionInicio).toBeNull();
    });

    it('limpia las horas de atencion al pasar a no_asistio', async () => {
      turnosRepository.findOne.mockResolvedValue({
        ...turnoProgramado(),
        estado: EstadoTurno.ATENDIDO,
        atencionInicio: new Date('2024-01-08T09:05:00.000Z'),
        atencionFin: new Date('2024-01-08T09:47:00.000Z'),
      } as Turno);

      const resultado = await service.actualizarEstado('turno-1', {
        estado: EstadoTurno.NO_ASISTIO,
      });

      // Si quedaran, esos 42 minutos de una marcacion corregida seguirian
      // pesando en el promedio del dashboard pese a que el cliente no vino.
      expect(resultado.atencionInicio).toBeNull();
      expect(resultado.atencionFin).toBeNull();
    });

    it('rechaza un fin anterior al inicio con 400 y no 500', async () => {
      turnosRepository.findOne.mockResolvedValue(turnoProgramado());

      await expect(
        service.actualizarEstado('turno-1', {
          estado: EstadoTurno.ATENDIDO,
          atencionInicio: '2024-01-08T09:47:00.000Z',
          atencionFin: '2024-01-08T09:05:00.000Z',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(turnosRepository.save).not.toHaveBeenCalled();
    });

    it('devuelve 404 si el turno no existe', async () => {
      turnosRepository.findOne.mockResolvedValue(null);

      await expect(
        service.actualizarEstado('turno-1', { estado: EstadoTurno.ATENDIDO }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    describe('reactivar un cancelado (011: los cancelados no ocupan)', () => {
      const cancelado = () =>
        ({
          ...turnoProgramado(),
          estado: EstadoTurno.CANCELADO,
          bahiaId: 'b-1',
          tecnicoId: 't-1',
          usuarioId: 'u-1',
        }) as Turno;

      it('409 con mensaje claro si otro turno ya tomo su horario', async () => {
        turnosRepository.findOne.mockResolvedValue(cancelado());
        turnosRepository.save.mockRejectedValue(
          crearQueryFailedError({ constraint: 'turnos_bahia_rango_excl' }),
        );

        const error = await service
          .actualizarEstado('turno-1', { estado: EstadoTurno.PROGRAMADO })
          .catch((e) => e);

        expect(error).toBeInstanceOf(ConflictException);
        expect(error.message).toMatch(/No se puede reactivar.*bahia/i);
      });

      it('nombra el recurso ocupado segun la constraint (tecnico)', async () => {
        turnosRepository.findOne.mockResolvedValue(cancelado());
        turnosRepository.save.mockRejectedValue(
          crearQueryFailedError({ constraint: 'turnos_tecnico_rango_excl' }),
        );

        const error = await service
          .actualizarEstado('turno-1', { estado: EstadoTurno.PROGRAMADO })
          .catch((e) => e);

        expect(error).toBeInstanceOf(ConflictException);
        expect(error.message).toMatch(/tecnico/i);
      });

      it('se reactiva normalmente si el horario sigue libre', async () => {
        turnosRepository.findOne.mockResolvedValue(cancelado());

        const resultado = await service.actualizarEstado('turno-1', {
          estado: EstadoTurno.PROGRAMADO,
        });

        expect(resultado.estado).toBe(EstadoTurno.PROGRAMADO);
      });

      it('un error que no es de solapamiento se repropaga tal cual', async () => {
        const caida = new Error('conexion perdida');
        turnosRepository.findOne.mockResolvedValue(cancelado());
        turnosRepository.save.mockRejectedValue(caida);

        await expect(
          service.actualizarEstado('turno-1', {
            estado: EstadoTurno.PROGRAMADO,
          }),
        ).rejects.toBe(caida);
      });
    });
  });

  it('las sugerencias no cuentan los turnos cancelados como ocupados (011)', async () => {
    turnosRepository.create.mockReturnValue({} as Turno);
    turnosRepository.save.mockRejectedValue(
      crearQueryFailedError({ constraint: 'turnos_bahia_rango_excl' }),
    );
    turnosRepository.find.mockResolvedValue([]);

    await service.create(dto, 'u-1').catch(() => undefined);

    const where = turnosRepository.find.mock.calls[0][0]?.where as {
      estado: { type: string; value: unknown };
    };
    // Not(EstadoTurno.CANCELADO) de TypeORM.
    expect(where.estado.type).toBe('not');
    expect(where.estado.value).toBe(EstadoTurno.CANCELADO);
  });

  describe('recursos fuera de servicio (Sprint 17)', () => {
    it('no reserva en una bahia inactiva', async () => {
      bahiasRepository.findOne.mockResolvedValue({ ...bahia, activa: false });

      await expect(service.create(dto, 'u-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(turnosRepository.save).not.toHaveBeenCalled();
    });

    it('no reserva un servicio dado de baja', async () => {
      serviciosService.findOne.mockResolvedValue({
        ...servicio,
        activo: false,
      });

      await expect(service.create(dto, 'u-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(turnosRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('disponibilidad', () => {
    const fecha = horaLocalBogota(9).slice(0, 10);
    const consulta = {
      bahiaId: bahia.id,
      servicioId: servicio.id,
      tecnicoId: 't-1',
      fecha,
    };

    it('ofrece la jornada del dia menos lo ocupado, con la duracion del servicio', async () => {
      turnosRepository.find.mockResolvedValue([
        {
          rangoTiempo: {
            inicio: new Date(`${fecha}T08:00:00-05:00`),
            fin: new Date(`${fecha}T12:00:00-05:00`),
          },
        } as Turno,
      ]);

      const r = await service.disponibilidad(consulta, 'u-1');

      expect(r.fecha).toBe(fecha);
      expect(r.zonaHoraria).toBe('America/Bogota');
      expect(r.duracionMinutos).toBe(30);
      expect(r.jornada).toEqual({ apertura: '08:00', cierre: '18:00' });
      expect(r.horarios[0].inicio).toEqual(new Date(`${fecha}T12:00:00-05:00`));
      // 12:00 ... 17:30
      expect(r.horarios).toHaveLength(23);
    });

    it('cuenta como ocupado lo de la bahia, lo del tecnico y lo del propio usuario, sin cancelados', async () => {
      turnosRepository.find.mockResolvedValue([]);

      await service.disponibilidad(consulta, 'u-1');

      const where = turnosRepository.find.mock.calls[0][0]?.where as Record<
        string,
        unknown
      >[];
      expect(where).toHaveLength(3);
      expect(where[0].bahiaId).toBe(bahia.id);
      expect(where[1].tecnicoId).toBe('t-1');
      expect(where[2].usuarioId).toBe('u-1');
      for (const rama of where) {
        expect((rama.estado as { type: string }).type).toBe('not');
      }
    });

    it('rechaza una fecha que no existe', async () => {
      await expect(
        service.disponibilidad({ ...consulta, fecha: '2026-02-31' }, 'u-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(turnosRepository.find).not.toHaveBeenCalled();
    });

    it('valida los recursos igual que la reserva', async () => {
      dataSource.query.mockResolvedValue([{ id: 't-1', rol: 'cliente' }]);

      await expect(
        service.disponibilidad(consulta, 'u-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('reserva a nombre de un cliente (Sprint 17)', () => {
    const admin = { sub: 'admin-1', rol: 'admin' };

    it('sin clienteId el turno es de quien reserva', async () => {
      await expect(
        service.resolverTitular({ sub: 'u-1', rol: 'cliente' }),
      ).resolves.toEqual({ usuarioId: 'u-1', paraCliente: false });
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('un admin puede reservar para un cliente existente', async () => {
      dataSource.query.mockResolvedValue([{ id: 'c-1', rol: 'cliente' }]);

      await expect(service.resolverTitular(admin, 'c-1')).resolves.toEqual({
        usuarioId: 'c-1',
        paraCliente: true,
      });
    });

    it('un cliente no puede reservar a nombre de otro: 403', async () => {
      await expect(
        service.resolverTitular({ sub: 'u-1', rol: 'cliente' }, 'c-2'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('404 si el id no es de un cliente (p. ej. un tecnico)', async () => {
      dataSource.query.mockResolvedValue([{ id: 't-1', rol: 'tecnico' }]);

      await expect(
        service.resolverTitular(admin, 't-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('el 409 por solapamiento del cliente habla del cliente, no de "vos"', async () => {
      turnosRepository.create.mockReturnValue({} as Turno);
      turnosRepository.save.mockRejectedValue(
        crearQueryFailedError({ constraint: 'turnos_usuario_rango_excl' }),
      );
      turnosRepository.find.mockResolvedValue([]);

      const error = await service.create(dto, 'c-1', true).catch((e) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse().message).toBe(
        'El cliente ya tiene otro turno reservado en ese horario.',
      );
      expect(turnosRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ usuarioId: 'c-1' }),
      );
    });
  });
});
