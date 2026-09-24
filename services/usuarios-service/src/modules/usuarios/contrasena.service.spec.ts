import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { DataSource } from 'typeorm';
import { ContrasenaService } from './contrasena.service';
import { CorreoService } from './correo.service';
import { TokenContrasena } from './entities/token-contrasena.entity';
import { RolUsuario, Usuario } from './entities/usuario.entity';

const usuario = {
  id: 'u-1',
  email: 'maria@correo.com',
  nombre: 'Maria',
  rol: RolUsuario.CLIENTE,
} as Usuario;

const sha = (t: string) => createHash('sha256').update(t).digest('hex');

describe('ContrasenaService', () => {
  let service: ContrasenaService;
  let tokens: {
    update: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    findOne: jest.Mock;
  };
  let correo: { enviar: jest.Mock };
  let usuarios: { findOne: jest.Mock; update: jest.Mock };
  let tokensTx: { update: jest.Mock; createQueryBuilder: jest.Mock };
  let filaToken: Partial<TokenContrasena> | null;

  beforeEach(async () => {
    tokens = {
      update: jest.fn(),
      save: jest.fn(async (t) => t),
      create: jest.fn((t) => t),
      findOne: jest.fn().mockResolvedValue(null),
    };
    correo = { enviar: jest.fn().mockResolvedValue(true) };
    usuarios = { findOne: jest.fn(), update: jest.fn() };
    filaToken = null;
    const qb = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn(async () => filaToken),
    };
    tokensTx = { update: jest.fn(), createQueryBuilder: jest.fn(() => qb) };
    const manager = {
      getRepository: (e: unknown) => (e === Usuario ? usuarios : tokensTx),
    };

    const module = await Test.createTestingModule({
      providers: [
        ContrasenaService,
        { provide: getRepositoryToken(TokenContrasena), useValue: tokens },
        { provide: CorreoService, useValue: correo },
        {
          provide: DataSource,
          useValue: {
            getRepository: () => usuarios,
            transaction: (cb: (m: typeof manager) => unknown) => cb(manager),
          },
        },
      ],
    }).compile();
    service = module.get(ContrasenaService);
  });

  describe('emitir', () => {
    it('guarda el hash del token, nunca el token, y lo manda en el enlace', async () => {
      await service.emitir(usuario, 'alta');

      const guardado = tokens.save.mock.calls[0][0];
      const texto: string = correo.enviar.mock.calls[0][0].texto;
      const token = /restablecer\?token=([\w-]+)/.exec(texto)![1];

      expect(token).toHaveLength(43);
      expect(guardado.tokenHash).toBe(sha(token));
      expect(JSON.stringify(guardado)).not.toContain(token);
      expect(correo.enviar.mock.calls[0][0].para).toBe(usuario.email);
    });

    it('el de alta vale 72 h y el de olvido 1 h', async () => {
      const antes = Date.now();
      await service.emitir(usuario, 'alta');
      await service.emitir(usuario, 'olvido');

      const [alta, olvido] = tokens.save.mock.calls.map(
        (c) => c[0].expiraEn.getTime() - antes,
      );
      expect(alta).toBeGreaterThanOrEqual(72 * 3_600_000 - 1_000);
      expect(olvido).toBeLessThanOrEqual(60 * 60_000 + 1_000);
    });

    it('anula los enlaces anteriores del usuario', async () => {
      await service.emitir(usuario, 'olvido');

      expect(tokens.update).toHaveBeenCalledWith(
        expect.objectContaining({ usuarioId: 'u-1' }),
        { usadoEn: expect.any(Date) },
      );
    });

    it('si SendGrid falla no rompe: avisa que no se envio', async () => {
      correo.enviar.mockRejectedValue(new Error('caido'));

      await expect(service.emitir(usuario, 'alta')).resolves.toEqual({
        enviado: false,
      });
    });
  });

  describe('solicitarRestablecimiento', () => {
    it('con un correo desconocido no hace nada (y no lo revela)', async () => {
      usuarios.findOne.mockResolvedValue(null);

      await expect(
        service.solicitarRestablecimiento('nadie@x.com'),
      ).resolves.toBeUndefined();
      expect(correo.enviar).not.toHaveBeenCalled();
    });

    it('no manda otro enlace si pidio uno hace menos de un minuto', async () => {
      usuarios.findOne.mockResolvedValue(usuario);
      tokens.findOne.mockResolvedValue({ id: 't' });

      await service.solicitarRestablecimiento(usuario.email);
      expect(correo.enviar).not.toHaveBeenCalled();
    });

    it('manda el enlace de olvido', async () => {
      usuarios.findOne.mockResolvedValue(usuario);

      await service.solicitarRestablecimiento(usuario.email);
      expect(tokens.save.mock.calls[0][0].motivo).toBe('olvido');
    });
  });

  describe('restablecer', () => {
    const vigente = () => ({
      id: 't-1',
      usuarioId: 'u-1',
      usadoEn: null,
      expiraEn: new Date(Date.now() + 60_000),
    });

    it('cambia la contrasena y marca el enlace como usado', async () => {
      filaToken = vigente();

      await service.restablecer('x'.repeat(43), 'nueva-clave');

      const [[donde, cambios]] = usuarios.update.mock.calls;
      expect(donde).toEqual({ id: 'u-1' });
      expect(bcrypt.compareSync('nueva-clave', cambios.passwordHash)).toBe(
        true,
      );
      expect(tokensTx.update).toHaveBeenCalledWith(
        { id: 't-1' },
        { usadoEn: expect.any(Date) },
      );
    });

    it.each([
      ['inexistente', null],
      ['ya usado', { ...vigente(), usadoEn: new Date() }],
      ['vencido', { ...vigente(), expiraEn: new Date(Date.now() - 1) }],
    ])('rechaza un enlace %s con 400', async (_caso, fila) => {
      filaToken = fila;

      await expect(
        service.restablecer('x'.repeat(43), 'nueva-clave'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(usuarios.update).not.toHaveBeenCalled();
    });
  });
});
