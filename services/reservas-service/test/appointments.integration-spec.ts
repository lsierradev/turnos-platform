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

describirSiHayDb('Appointments (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let bahiaId: string;
  let otraBahiaId: string;
  let servicioId: string;
  let usuarioId: string;
  let tecnicoId: string;
  let token: string;

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
      await dataSource.query('DELETE FROM usuarios WHERE id = $1 OR id = $2', [
        usuarioId,
        tecnicoId,
      ]);
    }
    await app?.close();
  });

  it('solo confirma una de dos reservas concurrentes sobre la misma bahia (HU2)', async () => {
    const inicio = new Date();
    inicio.setUTCDate(inicio.getUTCDate() + 3);
    inicio.setUTCHours(9, 0, 0, 0);

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
        .set('Authorization', `Bearer ${token}`)
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
    const inicio = new Date();
    inicio.setUTCDate(inicio.getUTCDate() + 4);
    inicio.setUTCHours(10, 0, 0, 0);

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
        .set('Authorization', `Bearer ${token}`)
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
});
