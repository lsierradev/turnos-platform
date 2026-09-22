import { Test, TestingModule } from '@nestjs/testing';
import { UsuariosService } from './usuarios.service';

describe('UsuariosService', () => {
  let service: UsuariosService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UsuariosService],
    }).compile();

    service = module.get<UsuariosService>(UsuariosService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('reports ok status', () => {
    expect(service.health()).toEqual({ status: 'ok', module: 'usuarios' });
  });
});
