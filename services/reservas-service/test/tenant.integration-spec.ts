import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as jwt from 'jsonwebtoken';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

/**
 * Aislamiento entre talleres (Sprint 20).
 *
 * Dos talleres completos (A y B) en la misma base. Cada prueba intenta
 * cruzar la frontera por un camino distinto: listar, pedir por id, reservar
 * con recursos del otro taller, cambiar el header, la cache. Lo que tiene
 * que frenar cada intento es la base (Row Level Security + FKs compuestas),
 * asi que tambien hay pruebas directas en SQL con el rol de la app.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describirSiHayDb = DATABASE_URL ? describe : describe.skip;
const SECRETO = process.env.JWT_SECRET ?? 'dev-secret-change-me';

function horaLocalBogota(hora: number, dias: number): string {
  const hoyBogota = new Date(Date.now() - 5 * 3_600_000);
  hoyBogota.setUTCDate(hoyBogota.getUTCDate() + dias);
  const fecha = hoyBogota.toISOString().slice(0, 10);
  return `${fecha}T${String(hora).padStart(2, '0')}:00:00-05:00`;
}

interface TallerDePrueba {
  id: string;
  bahiaId: string;
  servicioId: string;
  tecnicoId: string;
  adminId: string;
  tokenAdmin: string;
  tokenTecnico: string;
}

describirSiHayDb('Aislamiento entre talleres (integration)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let A: TallerDePrueba;
  let B: TallerDePrueba;
  let clienteId: string;
  let tokenCliente: string;
  const sufijo = `${Date.now()}`;

  async function crearTaller(letra: string): Promise<TallerDePrueba> {
    const [t] = await ds.query(
      `INSERT INTO talleres (nombre, slug) VALUES ($1, $2) RETURNING id`,
      [`Taller ${letra} ${sufijo}`, `taller-${letra.toLowerCase()}-${sufijo}`],
    );
    const [b] = await ds.query(
      `INSERT INTO bahias (nombre, taller_id) VALUES ($1, $2) RETURNING id`,
      [`Bahia ${letra} ${sufijo}`, t.id],
    );
    const [s] = await ds.query(
      `INSERT INTO servicios (nombre, categoria, duracion_minutos, precio, taller_id)
       VALUES ($1, 'mecanica', 30, 10000, $2) RETURNING id`,
      [`Servicio ${letra} ${sufijo}`, t.id],
    );
    const [tec] = await ds.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol, taller_id)
       VALUES ($1, 'hash', $2, 'tecnico', $3) RETURNING id`,
      [`tec-${letra}-${sufijo}@turnos.dev`, `Tecnico ${letra}`, t.id],
    );
    const [adm] = await ds.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol, taller_id)
       VALUES ($1, 'hash', $2, 'admin', $3) RETURNING id`,
      [`adm-${letra}-${sufijo}@turnos.dev`, `Admin ${letra}`, t.id],
    );
    return {
      id: t.id,
      bahiaId: b.id,
      servicioId: s.id,
      tecnicoId: tec.id,
      adminId: adm.id,
      tokenAdmin: jwt.sign(
        { sub: adm.id, email: 'a', rol: 'admin', taller: t.id },
        SECRETO,
      ),
      tokenTecnico: jwt.sign(
        { sub: tec.id, email: 't', rol: 'tecnico', taller: t.id },
        SECRETO,
      ),
    };
  }

  const get = (ruta: string, token: string, taller?: string) => {
    const r = request(app.getHttpServer())
      .get(ruta)
      .set('Authorization', `Bearer ${token}`);
    return taller ? r.set('X-Taller', taller) : r;
  };
  const reservar = (
    token: string,
    taller: string | undefined,
    cuerpo: object,
  ) => {
    const r = request(app.getHttpServer())
      .post('/appointments')
      .set('Authorization', `Bearer ${token}`);
    return (taller ? r.set('X-Taller', taller) : r).send(cuerpo);
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    ds = moduleRef.get(DataSource);

    A = await crearTaller('A');
    B = await crearTaller('B');
    const [cli] = await ds.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol)
       VALUES ($1, 'hash', 'Cliente de los dos', 'cliente') RETURNING id`,
      [`cli-ab-${sufijo}@turnos.dev`],
    );
    clienteId = cli.id;
    tokenCliente = jwt.sign(
      { sub: clienteId, email: 'c', rol: 'cliente' },
      SECRETO,
    );
  });

  afterAll(async () => {
    if (ds) {
      const talleres = [A?.id, B?.id].filter(Boolean);
      await ds.query('DELETE FROM notificaciones WHERE taller_id = ANY($1)', [
        talleres,
      ]);
      await ds.query('DELETE FROM turnos WHERE taller_id = ANY($1)', [
        talleres,
      ]);
      await ds.query('DELETE FROM servicios WHERE taller_id = ANY($1)', [
        talleres,
      ]);
      await ds.query('DELETE FROM bahias WHERE taller_id = ANY($1)', [
        talleres,
      ]);
      await ds.query(
        'DELETE FROM usuarios WHERE taller_id = ANY($1) OR id = $2',
        [talleres, clienteId],
      );
      await ds.query('DELETE FROM talleres WHERE id = ANY($1)', [talleres]);
    }
    await app?.close();
  });

  describe('el personal solo ve su taller', () => {
    it('bahias, servicios y tecnicos de A, nunca de B', async () => {
      const bahias = (await get('/bahias', A.tokenAdmin).expect(200)).body;
      expect(bahias.map((b: { id: string }) => b.id)).toContain(A.bahiaId);
      expect(bahias.map((b: { id: string }) => b.id)).not.toContain(B.bahiaId);

      const servicios = (await get('/servicios', A.tokenAdmin).expect(200))
        .body;
      expect(
        servicios.every((s: { tallerId: string }) => s.tallerId === A.id),
      ).toBe(true);

      const tecnicos = (await get('/technicians', A.tokenAdmin).expect(200))
        .body;
      expect(tecnicos.map((t: { id: string }) => t.id)).toEqual([A.tecnicoId]);
    });

    it('un id de B se trata como inexistente (404), no como prohibido', async () => {
      await get(`/servicios/${B.servicioId}`, A.tokenAdmin).expect(404);
      await get(`/bahias/${B.bahiaId}/turnos`, A.tokenAdmin).expect(404);
      await get(`/technicians/${B.tecnicoId}/agenda`, A.tokenAdmin).expect(404);
    });

    it('cambiar el header X-Taller no sirve: el personal usa el taller de su token', async () => {
      const bahias = (await get('/bahias', A.tokenAdmin, B.id).expect(200))
        .body;
      expect(bahias.map((b: { id: string }) => b.id)).not.toContain(B.bahiaId);
    });

    it('no puede reservar con la bahia, el servicio o el tecnico de otro taller', async () => {
      const inicio = horaLocalBogota(9, 3);
      await reservar(A.tokenAdmin, undefined, {
        bahiaId: B.bahiaId,
        servicioId: A.servicioId,
        tecnicoId: A.tecnicoId,
        inicio,
      }).expect(404);
      await reservar(A.tokenAdmin, undefined, {
        bahiaId: A.bahiaId,
        servicioId: A.servicioId,
        tecnicoId: B.tecnicoId,
        inicio,
      }).expect(404);
    });
  });

  describe('el cliente reserva en varios talleres', () => {
    let turnoA: string;
    let turnoB: string;

    it('sin elegir taller no puede reservar', async () => {
      const r = await reservar(tokenCliente, undefined, {
        bahiaId: A.bahiaId,
        servicioId: A.servicioId,
        tecnicoId: A.tecnicoId,
        inicio: horaLocalBogota(10, 3),
      }).expect(400);
      expect(r.body.message).toMatch(/Elegi un taller/);
    });

    it('reserva en A y en B, y queda relacionado con los dos', async () => {
      turnoA = (
        await reservar(tokenCliente, A.id, {
          bahiaId: A.bahiaId,
          servicioId: A.servicioId,
          tecnicoId: A.tecnicoId,
          inicio: horaLocalBogota(10, 3),
        }).expect(201)
      ).body.id;
      turnoB = (
        await reservar(tokenCliente, B.id, {
          bahiaId: B.bahiaId,
          servicioId: B.servicioId,
          tecnicoId: B.tecnicoId,
          inicio: horaLocalBogota(14, 3),
        }).expect(201)
      ).body.id;

      const relaciones = await ds.query(
        'SELECT taller_id FROM clientes_taller WHERE usuario_id = $1',
        [clienteId],
      );
      expect(
        relaciones.map((r: { taller_id: string }) => r.taller_id).sort(),
      ).toEqual([A.id, B.id].sort());
    });

    it('con X-Taller de B pidiendo la bahia de A: 404', async () => {
      await reservar(tokenCliente, B.id, {
        bahiaId: A.bahiaId,
        servicioId: B.servicioId,
        tecnicoId: B.tecnicoId,
        inicio: horaLocalBogota(16, 3),
      }).expect(404);
    });

    it('"Mis turnos" junta los dos talleres, cada uno con su nombre', async () => {
      const mios = (await get('/appointments/mios', tokenCliente).expect(200))
        .body;
      const porId = Object.fromEntries(
        mios.map((t: { id: string }) => [t.id, t]),
      );
      expect(porId[turnoA].taller.nombre).toBe(`Taller A ${sufijo}`);
      expect(porId[turnoB].taller.nombre).toBe(`Taller B ${sufijo}`);
      expect(porId[turnoB].bahia).toBe(`Bahia B ${sufijo}`);
    });

    it('el admin de A no ve el turno del cliente en B', async () => {
      await request(app.getHttpServer())
        .patch(`/appointments/${turnoB}/estado`)
        .set('Authorization', `Bearer ${A.tokenAdmin}`)
        .send({ estado: 'cancelado' })
        .expect(404);
    });

    it('carga y KPIs cuentan solo lo propio, con cache separada por taller', async () => {
      const dia = horaLocalBogota(10, 3).slice(0, 10);
      const kpisA = (
        await get(`/dashboard/kpis?from=${dia}&to=${dia}`, A.tokenAdmin).expect(
          200,
        )
      ).body;
      const kpisB = (
        await get(`/dashboard/kpis?from=${dia}&to=${dia}`, B.tokenAdmin).expect(
          200,
        )
      ).body;
      expect(kpisA.resumen.turnosTotales).toBe(1);
      expect(kpisB.resumen.turnosTotales).toBe(1);

      const cargaA = (
        await get(
          `/bahias/carga?desde=${dia}&hasta=${dia}`,
          A.tokenAdmin,
        ).expect(200)
      ).body;
      expect(cargaA.bahias.map((b: { bahiaId: string }) => b.bahiaId)).toEqual([
        A.bahiaId,
      ]);
    });
  });

  describe('talleres dados de baja y headers invalidos', () => {
    it('X-Taller que no es un uuid: 400; de un taller que no existe: 404', async () => {
      await get('/bahias', tokenCliente, 'no-es-uuid').expect(400);
      await get(
        '/bahias',
        tokenCliente,
        '11111111-1111-4111-8111-111111111111',
      ).expect(404);
    });

    it('el personal de un taller dado de baja no opera (403)', async () => {
      await ds.query('UPDATE talleres SET activo = false WHERE id = $1', [
        B.id,
      ]);
      try {
        await get('/bahias', B.tokenAdmin).expect(403);
      } finally {
        await ds.query('UPDATE talleres SET activo = true WHERE id = $1', [
          B.id,
        ]);
      }
    });
  });

  describe('la base frena lo que el codigo dejara pasar', () => {
    async function comoAdminDe(
      taller: string,
      fn: (q: (s: string, p?: unknown[]) => Promise<any>) => Promise<void>,
    ) {
      const qr = ds.createQueryRunner();
      await qr.connect();
      await qr.startTransaction();
      try {
        await qr.query('SET LOCAL ROLE turnos_app');
        await qr.query(
          `SELECT set_config('app.taller_id', $1, true), set_config('app.rol', 'admin', true)`,
          [taller],
        );
        await fn((s, p) => qr.query(s, p));
      } finally {
        await qr.rollbackTransaction();
        await qr.release();
      }
    }

    it('RLS: un SELECT sin WHERE no devuelve filas de otro taller', async () => {
      await comoAdminDe(A.id, async (q) => {
        const bahias = await q('SELECT taller_id FROM bahias');
        expect(
          bahias.every((b: { taller_id: string }) => b.taller_id === A.id),
        ).toBe(true);
        const turnos = await q('SELECT taller_id FROM turnos');
        expect(
          turnos.every((t: { taller_id: string }) => t.taller_id === A.id),
        ).toBe(true);
      });
    });

    it('RLS: no se puede escribir en otro taller', async () => {
      await comoAdminDe(A.id, async (q) => {
        await expect(
          q(`INSERT INTO bahias (nombre, taller_id) VALUES ('intrusa', $1)`, [
            B.id,
          ]),
        ).rejects.toThrow(/row-level security|seguridad de registro/i);
      });
    });

    it('FK compuesta: un turno de A no puede apuntar a la bahia de B', async () => {
      await expect(
        ds.query(
          `INSERT INTO turnos (taller_id, bahia_id, servicio_id, rango_tiempo)
           VALUES ($1, $2, $3, tstzrange(now() + interval '5 days', now() + interval '5 days 30 minutes'))`,
          [A.id, B.bahiaId, A.servicioId],
        ),
      ).rejects.toThrow(/turnos_bahia_taller_fkey/);
    });
  });
});
