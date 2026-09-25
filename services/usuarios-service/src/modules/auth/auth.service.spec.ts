import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { RolUsuario, Usuario } from '../usuarios/entities/usuario.entity';
import { UsuariosService } from '../usuarios/usuarios.service';
import { AuthService } from './auth.service';

jest.mock('bcryptjs');

describe('AuthService', () => {
  let service: AuthService;
  let usuariosService: jest.Mocked<UsuariosService>;
  let jwtService: jest.Mocked<JwtService>;

  const usuario: Usuario = {
    id: 'u-1',
    email: 'ana@turnos.dev',
    passwordHash: 'hashed-password',
    nombre: 'Ana',
    rol: RolUsuario.CLIENTE,
    telefono: null,
    creadoEn: new Date(),
    actualizadoEn: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsuariosService,
          useValue: {
            findByEmail: jest.fn(),
            findById: jest.fn(),
            create: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: { sign: jest.fn(), verify: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usuariosService = module.get(UsuariosService);
    jwtService = module.get(JwtService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validateUser', () => {
    it('devuelve el usuario cuando las credenciales son correctas', async () => {
      usuariosService.findByEmail.mockResolvedValue(usuario);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(
        service.validateUser(usuario.email, 'password123'),
      ).resolves.toEqual(usuario);
    });

    it('lanza UnauthorizedException si el usuario no existe', async () => {
      usuariosService.findByEmail.mockResolvedValue(null);

      await expect(
        service.validateUser('no-existe@turnos.dev', 'password123'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('lanza UnauthorizedException si la password es incorrecta', async () => {
      usuariosService.findByEmail.mockResolvedValue(usuario);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.validateUser(usuario.email, 'password-incorrecta'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('login', () => {
    it('firma un access token y un refresh token', async () => {
      jwtService.sign
        .mockReturnValueOnce('access-token')
        .mockReturnValueOnce('refresh-token');

      const tokens = await service.login(usuario);

      expect(tokens).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
      // Sprint 20: el token lleva el taller (null para un cliente).
      expect(jwtService.sign).toHaveBeenNthCalledWith(1, {
        sub: usuario.id,
        email: usuario.email,
        rol: usuario.rol,
        taller: null,
      });
      expect(jwtService.sign).toHaveBeenNthCalledWith(
        2,
        {
          sub: usuario.id,
          email: usuario.email,
          rol: usuario.rol,
          taller: null,
        },
        expect.objectContaining({ secret: expect.any(String) }),
      );
    });
  });

  describe('refresh', () => {
    const ahoraSeg = () => Math.floor(Date.now() / 1000);

    it('emite un nuevo access token cuando el refresh token es valido', async () => {
      jwtService.verify.mockReturnValue({
        sub: usuario.id,
        email: usuario.email,
        rol: usuario.rol,
        iat: ahoraSeg(),
      });
      usuariosService.findById.mockResolvedValue(usuario);
      jwtService.sign.mockReturnValue('nuevo-access-token');

      await expect(service.refresh('token-valido')).resolves.toEqual({
        accessToken: 'nuevo-access-token',
      });
    });

    describe('cambio de contrasena (Sprint 19)', () => {
      const cambio = new Date();

      it('rechaza un refresh emitido antes del cambio de contrasena', async () => {
        jwtService.verify.mockReturnValue({
          sub: usuario.id,
          iat: ahoraSeg() - 3600,
        });
        usuariosService.findById.mockResolvedValue({
          ...usuario,
          sesionesValidasDesde: cambio,
        });

        await expect(service.refresh('token-viejo')).rejects.toThrow(
          /cambio la contrasena/,
        );
      });

      it('acepta el refresh del login posterior, aunque sea el mismo segundo', async () => {
        jwtService.verify.mockReturnValue({
          sub: usuario.id,
          iat: Math.floor(cambio.getTime() / 1000),
        });
        usuariosService.findById.mockResolvedValue({
          ...usuario,
          sesionesValidasDesde: cambio,
        });
        jwtService.sign.mockReturnValue('nuevo');

        await expect(service.refresh('token-nuevo')).resolves.toEqual({
          accessToken: 'nuevo',
        });
      });

      it('rechaza el refresh de un usuario que ya no existe', async () => {
        jwtService.verify.mockReturnValue({ sub: 'borrado', iat: ahoraSeg() });
        usuariosService.findById.mockResolvedValue(null);

        await expect(service.refresh('token')).rejects.toThrow(
          UnauthorizedException,
        );
      });

      it('firma con el rol actual de la base, no el del token viejo', async () => {
        jwtService.verify.mockReturnValue({
          sub: usuario.id,
          rol: 'cliente',
          iat: ahoraSeg(),
        });
        usuariosService.findById.mockResolvedValue({
          ...usuario,
          rol: RolUsuario.TECNICO,
        });
        jwtService.sign.mockReturnValue('t');

        await service.refresh('token');
        expect(jwtService.sign).toHaveBeenCalledWith(
          expect.objectContaining({ rol: RolUsuario.TECNICO }),
        );
      });
    });

    it('lanza UnauthorizedException si el refresh token es invalido', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(service.refresh('token-invalido')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
