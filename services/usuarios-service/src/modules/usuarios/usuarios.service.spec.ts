import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Usuario } from './entities/usuario.entity';
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
});
