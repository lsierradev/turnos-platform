import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { ContextoDb, Sesion } from '@turnos-platform/tenant';
import { CATALOGO, versionVigente } from './catalogo';
import { LegalService } from './legal.service';

const TALLER = '7a7a7a7a-0000-4000-8000-000000000001';
const origen = { ip: '10.0.0.1', userAgent: 'jest' };

function servicio(respuestas: unknown[][] = []) {
  const query = jest.fn();
  for (const r of respuestas) query.mockResolvedValueOnce(r);
  query.mockResolvedValue([]);
  const db = {
    query,
    exigirTaller: jest.fn(() => TALLER),
  } as unknown as ContextoDb;
  return { legal: new LegalService(db), query };
}

const cliente: Sesion = { usuarioId: 'u-1', rol: 'cliente', tallerId: null };
const admin: Sesion = { usuarioId: 'a-1', rol: 'admin', tallerId: TALLER };

describe('LegalService.pendientes', () => {
  it('pide todo lo del rol que no acepto', async () => {
    const { legal } = servicio([[]]);
    const pendientes = await legal.pendientes(admin);
    expect(pendientes.map((d) => d.documento)).toEqual([
      'terminos_taller',
      'politica_datos',
      'autorizacion_datos',
    ]);
    expect(pendientes[0].contenido).toMatch(/TurnoPro/);
  });

  it('no pide lo que ya acepto en la version vigente', async () => {
    const { legal } = servicio([
      [
        { documento: 'politica_datos', version: 1 },
        { documento: 'autorizacion_datos', version: 1 },
      ],
    ]);
    expect(await legal.pendientes(cliente)).toEqual([]);
  });

  it('una version nueva lo vuelve a pedir', async () => {
    const versiones = CATALOGO.autorizacion_datos.versiones;
    versiones.push({ ...versiones[0], version: 2 });
    try {
      const { legal } = servicio([
        [
          { documento: 'politica_datos', version: 1 },
          { documento: 'autorizacion_datos', version: 1 },
        ],
      ]);
      const pendientes = await legal.pendientes(cliente);
      expect(pendientes).toHaveLength(1);
      expect(pendientes[0]).toMatchObject({
        documento: 'autorizacion_datos',
        version: 2,
      });
    } finally {
      versiones.pop();
    }
  });

  it('el superadmin no tiene nada que aceptar (ni consulta)', async () => {
    const { legal, query } = servicio();
    const pendientes = await legal.pendientes({
      usuarioId: 's',
      rol: 'superadmin',
      tallerId: null,
    });
    expect(pendientes).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('LegalService.aceptar', () => {
  it('rechaza una version que no es la vigente con 409', async () => {
    const { legal } = servicio();
    await expect(
      legal.aceptar(
        cliente,
        { documento: 'politica_datos', version: 99, canal: 'web' },
        origen,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('un cliente no acepta los terminos del taller', async () => {
    const { legal } = servicio();
    await expect(
      legal.aceptar(
        cliente,
        { documento: 'terminos_taller', version: 1, canal: 'web' },
        origen,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('guarda el hash del texto vigente, la IP y el navegador', async () => {
    const { legal, query } = servicio([[{ id: 'ac-1' }], [{ id: 'ac-1' }]]);
    await legal.aceptar(
      cliente,
      { documento: 'politica_datos', version: 1, canal: 'web' },
      origen,
    );
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO aceptaciones_legales/);
    expect(params).toEqual([
      'u-1',
      'politica_datos',
      1,
      versionVigente('politica_datos').sha256,
      null,
      'web',
      '10.0.0.1',
      'jest',
      null,
    ]);
  });
});

describe('LegalService.publicarCondiciones', () => {
  it('no publica con marcas pendientes', async () => {
    const { legal, query } = servicio();
    await expect(
      legal.publicarCondiciones(
        admin,
        'Texto con ⟦COMPLETAR: NIT⟧ '.repeat(20),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it('numera la version siguiente a la vigente', async () => {
    const vigente = {
      version: 3,
      contenido: 'viejo',
      sha256: 'x'.repeat(64),
      publicadoEn: new Date(),
    };
    const { legal, query } = servicio([[vigente], [], [vigente]]);
    await legal.publicarCondiciones(admin, 'Condiciones nuevas. '.repeat(20));
    const [sql, params] = query.mock.calls[1];
    expect(sql).toMatch(/INSERT INTO condiciones_taller/);
    expect(params[0]).toBe(TALLER);
    expect(params[1]).toBe(4);
    expect(params[5]).toBe('a-1');
  });
});
