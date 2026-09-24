import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as jwt from 'jsonwebtoken';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

// Este test necesita una Postgres real (con las migraciones de
// packages/database/migrations aplicadas) para poder probar de verdad las
// dos constraints EXCLUDE USING gist de turnos (bahia y tecnico) bajo
// concurrencia. No corre como parte de `pnpm test` (jest-integration.json es
// un config separado, igual que jest-e2e.json) y se salta si no hay
// DATABASE_URL.
const DATABASE_URL = process.env.DATABASE_URL;
const describirSiHayDb = DATABASE_URL ? describe : describe.skip;

if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    'DATABASE_URL no esta seteada: se omite appointments.integration-spec.ts. ' +
      'Ver packages/database/README.md para levantar una Postgres local.',
  );
}

// Hora de pared de Bogota (TZ_NEGOCIO por defecto, UTC-5 fijo) `dias` dias
// adelante. Desde Sprint 12 el horario laboral es 8-18 LOCAL: las 09:00Z que
// se usaban antes son las 04:00 en Bogota y ahora se rechazan.
function horaLocalBogota(hora: number, dias: number): string {
  const hoyBogota = new Date(Date.now() - 5 * 3_600_000);
  hoyBogota.setUTCDate(hoyBogota.getUTCDate() + dias);
  const fecha = hoyBogota.toISOString().slice(0, 10);
  return `${fecha}T${String(hora).padStart(2, '0')}:00:00-05:00`;
}

describirSiHayDb('Appointments (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let bahiaId: string;
  let otraBahiaId: string;
  let servicioId: string;
  let usuarioId: string;
  let otroUsuarioId: string;
  let tecnicoId: string;
  let token: string;
  // Desde la migracion 010 un mismo usuario tampoco puede tener dos turnos
  // solapados. Si los dos intentos concurrentes vinieran del mismo cliente
  // se violarian DOS constraints a la vez y el mensaje del 409 dependeria de
  // cual evalue Postgres primero: el test quedaria intermitente. Dos
  // clientes distintos peleando por el mismo horario es ademas el escenario
  // real del double-booking.
  let otroToken: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    dataSource = moduleRef.get(DataSource);

    const bahia = await dataSource.query(
      "INSERT INTO bahias (nombre) VALUES ('Bahia integration test') RETURNING id",
    );
    bahiaId = bahia[0].id;

    const otraBahia = await dataSource.query(
      "INSERT INTO bahias (nombre) VALUES ('Otra bahia integration test') RETURNING id",
    );
    otraBahiaId = otraBahia[0].id;

    const servicio = await dataSource.query(
      `INSERT INTO servicios (nombre, categoria, duracion_minutos, precio)
       VALUES ('Servicio integration test', 'mecanica', 30, 10000)
       RETURNING id`,
    );
    servicioId = servicio[0].id;

    const usuario = await dataSource.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol)
       VALUES ('integration-test@turnos.dev', 'hash', 'Integration Test', 'cliente')
       RETURNING id`,
    );
    usuarioId = usuario[0].id;

    const otroUsuario = await dataSource.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol)
       VALUES ('integration-test-2@turnos.dev', 'hash', 'Integration Test 2', 'cliente')
       RETURNING id`,
    );
    otroUsuarioId = otroUsuario[0].id;

    const tecnico = await dataSource.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol)
       VALUES ('tecnico-integration-test@turnos.dev', 'hash', 'Tecnico Integration Test', 'tecnico')
       RETURNING id`,
    );
    tecnicoId = tecnico[0].id;

    token = jwt.sign(
      { sub: usuarioId, email: 'integration-test@turnos.dev', rol: 'cliente' },
      process.env.JWT_SECRET ?? 'dev-secret-change-me',
    );

    otroToken = jwt.sign(
      {
        sub: otroUsuarioId,
        email: 'integration-test-2@turnos.dev',
        rol: 'cliente',
      },
      process.env.JWT_SECRET ?? 'dev-secret-change-me',
    );
  });

  afterAll(async () => {
    if (dataSource) {
      await dataSource.query(
        'DELETE FROM turnos WHERE bahia_id = $1 OR bahia_id = $2',
        [bahiaId, otraBahiaId],
      );
      await dataSource.query('DELETE FROM servicios WHERE id = $1', [
        servicioId,
      ]);
      await dataSource.query('DELETE FROM bahias WHERE id = $1 OR id = $2', [
        bahiaId,
        otraBahiaId,
      ]);
      await dataSource.query('DELETE FROM usuarios WHERE id = ANY($1)', [
        [usuarioId, otroUsuarioId, tecnicoId],
      ]);
    }
    await app?.close();
  });

  it('solo confirma una de dos reservas concurrentes sobre la misma bahia (HU2)', async () => {
    const inicio = new Date(horaLocalBogota(9, 3));

    const body = {
      bahiaId,
      servicioId,
      tecnicoId,
      inicio: inicio.toISOString(),
    };

    const server = app.getHttpServer();
    const resultados = await Promise.allSettled([
      request(server)
        .post('/appointments')
        .set('Authorization', `Bearer ${token}`)
        .send(body),
      request(server)
        .post('/appointments')
        .set('Authorization', `Bearer ${otroToken}`)
        .send(body),
    ]);

    const respuestas = resultados.map((r) =>
      r.status === 'fulfilled' ? r.value : null,
    );

    const exitosas = respuestas.filter((r) => r?.status === 201);
    const conflictos = respuestas.filter((r) => r?.status === 409);

    expect(exitosas).toHaveLength(1);
    expect(conflictos).toHaveLength(1);
    expect(Array.isArray(conflictos[0]!.body.sugerencias)).toBe(true);
    expect(conflictos[0]!.body.sugerencias.length).toBeLessThanOrEqual(3);
  });

  it('rechaza el mismo tecnico en dos bahias distintas al mismo horario', async () => {
    const inicio = new Date(horaLocalBogota(10, 4));

    const server = app.getHttpServer();
    const resultados = await Promise.allSettled([
      request(server)
        .post('/appointments')
        .set('Authorization', `Bearer ${token}`)
        .send({
          bahiaId,
          servicioId,
          tecnicoId,
          inicio: inicio.toISOString(),
        }),
      request(server)
        .post('/appointments')
        .set('Authorization', `Bearer ${otroToken}`)
        .send({
          bahiaId: otraBahiaId,
          servicioId,
          tecnicoId,
          inicio: inicio.toISOString(),
        }),
    ]);

    const respuestas = resultados.map((r) =>
      r.status === 'fulfilled' ? r.value : null,
    );

    const exitosas = respuestas.filter((r) => r?.status === 201);
    const conflictos = respuestas.filter((r) => r?.status === 409);

    expect(exitosas).toHaveLength(1);
    expect(conflictos).toHaveLength(1);
    expect(conflictos[0]!.body.message).toMatch(/tecnico/i);
  });

  it('un turno cancelado libera su horario y no se puede reactivar si otro lo tomo (011)', async () => {
    const server = app.getHttpServer();
    const inicio = new Date(horaLocalBogota(11, 5)).toISOString();
    const tokenAdmin = jwt.sign(
      { sub: usuarioId, email: 'admin-integration@turnos.dev', rol: 'admin' },
      process.env.JWT_SECRET ?? 'dev-secret-change-me',
    );
    const reservar = (t: string) =>
      request(server)
        .post('/appointments')
        .set('Authorization', `Bearer ${t}`)
        .send({ bahiaId, servicioId, tecnicoId, inicio });

    const original = await reservar(token).expect(201);

    await request(server)
      .patch(`/appointments/${original.body.id}/estado`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ estado: 'cancelado' })
      .expect(200);

    // Misma bahia, mismo tecnico, mismo horario: antes de 011 daba 409
    // porque el cancelado seguia ocupando.
    await reservar(otroToken).expect(201);

    // Reactivar el cancelado ahora chocaria con el nuevo: 409 claro, no 500.
    const reactivar = await request(server)
      .patch(`/appointments/${original.body.id}/estado`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ estado: 'programado' })
      .expect(409);
    expect(reactivar.body.message).toMatch(/No se puede reactivar/);
  });
});
