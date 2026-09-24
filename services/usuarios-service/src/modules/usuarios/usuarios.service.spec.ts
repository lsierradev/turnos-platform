import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException } from '@nestjs/common';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { RolUsuario, Usuario } from './entities/usuario.entity';
import { UsuariosService } from './usuarios.service';

describe('UsuariosService', () => {
  let service: UsuariosService;
  let repository: jest.Mocked<Repository<Usuario>>;
  let dataSource: { query: jest.Mock };

  beforeEach(async () => {
    dataSource = { query: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsuariosService,
        {
          provide: getRepositoryToken(Usuario),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<UsuariosService>(UsuariosService);
    repository = module.get(getRepositoryToken(Usuario));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('reports ok status', () => {
    expect(service.health()).toEqual({ status: 'ok', module: 'usuarios' });
  });

  it('el liveness no toca Postgres', () => {
    service.health();

    // Deliberado: si el liveness probara la base, una caida momentanea haria
    // que el orquestador reiniciara pods que estan sanos.
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  describe('readiness', () => {
    it('reporta ok cuando Postgres responde', async () => {
      await expect(service.readiness()).resolves.toEqual({
        status: 'ok',
        module: 'usuarios',
        dependencias: { postgres: { status: 'up' } },
      });
    });

    it('reporta degradado cuando Postgres no responde', async () => {
      dataSource.query.mockRejectedValue(new Error('connection refused'));

      const resultado = await service.readiness();

      expect(resultado.status).toBe('degraded');
      expect(resultado.dependencias.postgres).toEqual({
        status: 'down',
        error: 'connection refused',
      });
    });

    it('una base colgada no cuelga el probe', async () => {
      dataSource.query.mockImplementation(() => new Promise(() => undefined));

      const resultado = await service.readiness();

      expect(resultado.dependencias.postgres.error).toMatch(/timeout/i);
    }, 10_000);
  });

  it('finds a usuario by email', async () => {
    const usuario = { id: '1', email: 'a@a.com' } as Usuario;
    repository.findOne.mockResolvedValue(usuario);

    await expect(service.findByEmail('a@a.com')).resolves.toEqual(usuario);
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { email: 'a@a.com' },
    });
  });

  describe('findAll', () => {
    const selectEsperado = [
      'id',
      'email',
      'nombre',
      'rol',
      'telefono',
      'ciudad',
      'creadoEn',
      'actualizadoEn',
    ];

    it('lista todos los usuarios sin filtro de rol', async () => {
      const usuarios = [{ id: '1' }, { id: '2' }] as Usuario[];
      repository.find.mockResolvedValue(usuarios);

      await expect(service.findAll()).resolves.toEqual(usuarios);
      expect(repository.find).toHaveBeenCalledWith({
        where: {},
        select: selectEsperado,
      });
    });

    it('filtra por rol cuando se lo pasan', async () => {
      const tecnicos = [{ id: '1', rol: RolUsuario.TECNICO }] as Usuario[];
      repository.find.mockResolvedValue(tecnicos);

      await expect(service.findAll(RolUsuario.TECNICO)).resolves.toEqual(
        tecnicos,
      );
      expect(repository.find).toHaveBeenCalledWith({
        where: { rol: RolUsuario.TECNICO },
        select: selectEsperado,
      });
    });

    it('nunca devuelve el password_hash', async () => {
      repository.find.mockResolvedValue([]);

      await service.findAll();

      expect(repository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.not.arrayContaining(['passwordHash']),
        }),
      );
    });
  });

  describe('create', () => {
    const input = {
      email: 'cliente@taller.dev',
      password: 'secreta123',
      nombre: 'Cliente',
    };

    it('crea clientes por defecto y guarda el hash, no la contrasena', async () => {
      repository.create.mockImplementation((u) => u as Usuario);
      repository.save.mockImplementation(async (u) => u as Usuario);

      const creado = await service.create(input);

      expect(creado.rol).toBe(RolUsuario.CLIENTE);
      expect(creado.passwordHash).not.toBe(input.password);
    });

    it('sin password guarda el hash de un secreto al azar, nunca vacio', async () => {
      repository.create.mockImplementation((u) => u as Usuario);
      repository.save.mockImplementation(async (u) => u as Usuario);

      const a = await service.create({
        email: 'a@taller.dev',
        nombre: 'A',
        ciudad: ' Medellin ',
      });
      const b = await service.create({ email: 'b@taller.dev', nombre: 'B' });

      expect(a.passwordHash).toMatch(/^\$2[aby]\$/);
      // Ni vacia ni una constante: nadie puede entrar con esa cuenta.
      expect(bcrypt.compareSync('', a.passwordHash)).toBe(false);
      expect(a.ciudad).toBe('Medellin');
      expect(b.ciudad).toBeNull();
    });

    it('un correo repetido es 409 con mensaje util, no el error de Postgres', async () => {
      repository.create.mockImplementation((u) => u as Usuario);
      repository.save.mockRejectedValue(
        new QueryFailedError('INSERT', [], {
          code: '23505',
          constraint: 'usuarios_email_key',
        } as any),
      );

      const error = await service.create(input).catch((e) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(
        'Ya existe un usuario con el correo cliente@taller.dev.',
      );
    });
  });
});
