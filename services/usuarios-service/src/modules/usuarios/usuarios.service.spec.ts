import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Usuario } from './entities/usuario.entity';
import { UsuariosService } from './usuarios.service';

describe('UsuariosService', () => {
  let service: UsuariosService;
  let repository: jest.Mocked<Repository<Usuario>>;

  beforeEach(async () => {
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

  it('finds a usuario by email', async () => {
    const usuario = { id: '1', email: 'a@a.com' } as Usuario;
    repository.findOne.mockResolvedValue(usuario);

    await expect(service.findByEmail('a@a.com')).resolves.toEqual(usuario);
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { email: 'a@a.com' },
    });
  });
});
