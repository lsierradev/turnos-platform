import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as jwt from 'jsonwebtoken';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

// Mismo criterio que dashboard.integration-spec.ts: Postgres real con las
// migraciones aplicadas; se salta si no hay DATABASE_URL. Los unit tests de
// BahiasService mockean DataSource: esto es lo que prueba el SQL (recorte a
// la jornada local, dia del taller, cancelados, CROSS JOIN de bahias).
// Taller de los datos de prueba: el "Taller principal" que crea la migracion
// 015 (Sprint 20). Los tokens de admin y tecnico lo llevan; los requests de
// cliente lo mandan en X-Taller. El aislamiento ENTRE talleres se prueba
// aparte, en tenant.integration-spec.ts.
const TALLER = '00000000-0000-4000-8000-000000000001';

const DATABASE_URL = process.env.DATABASE_URL;
const describirSiHayDb = DATABASE_URL ? describe : describe.skip;

if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    'DATABASE_URL no esta seteada: se omite bahias.integration-spec.ts. ' +
      'Ver packages/database/README.md para levantar una Postgres local.',
  );
}

describirSiHayDb('Bahias - carga (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let bahiaLlena: string;
  let bahiaBordes: string;
  let bahiaInactiva: string;
  let servicioId: string;
  let clienteId: string;
  let tecnicoId: string;
  let tokenAdmin: string;
  let tokenCliente: string;

  // Fechas fijas y lejanas: el rango solo tiene lo que siembra este test.
  const DIA = '2019-04-10';
  const DIA_SIGUIENTE = '2019-04-11';

  // Hora de pared de Bogota (TZ_NEGOCIO por defecto, UTC-5 sin DST).
  const local = (dia: string, hhmm: string) => `${dia}T${hhmm}:00-05:00`;

  async function turno(
    bahiaId: string,
    inicio: string,
    fin: string,
    estado = 'programado',
    conPersonas = true,
  ) {
    // Sin tecnico ni cliente (NULL) en las bahias que se solapan en horario
    // con la llena: si no, las EXCLUDE de tecnico (006) y de cliente (010)
    // rechazarian el INSERT. Los NULL no participan de un EXCLUDE.
    await dataSource.query(
      `INSERT INTO turnos (taller_id, bahia_id, servicio_id, usuario_id, tecnico_id, rango_tiempo, estado)
       VALUES ('00000000-0000-4000-8000-000000000001', $1, $2, $3, $4, tstzrange($5::timestamptz, $6::timestamptz, '[)'), $7::estado_turno)`,
      [
        bahiaId,
        servicioId,
        conPersonas ? clienteId : null,
        conPersonas ? tecnicoId : null,
        inicio,
        fin,
        estado,
      ],
    );
  }

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

    const sufijo = Date.now();
    const [a] = await dataSource.query(
      `INSERT INTO bahias (nombre, taller_id) VALUES ($1, '00000000-0000-4000-8000-000000000001') RETURNING id`,
      [`AAA carga llena ${sufijo}`],
    );
    const [b] = await dataSource.query(
      `INSERT INTO bahias (nombre, taller_id) VALUES ($1, '00000000-0000-4000-8000-000000000001') RETURNING id`,
      [`AAB carga bordes ${sufijo}`],
    );
    const [c] = await dataSource.query(
      `INSERT INTO bahias (nombre, activa, taller_id) VALUES ($1, false, '00000000-0000-4000-8000-000000000001') RETURNING id`,
      [`AAC carga inactiva ${sufijo}`],
    );
    [bahiaLlena, bahiaBordes, bahiaInactiva] = [a.id, b.id, c.id];

    const [s] = await dataSource.query(
      `INSERT INTO servicios (nombre, categoria, duracion_minutos, precio_base_centavos, taller_id)
       VALUES ('Servicio carga test', 'mecanica', 60, 10000, '00000000-0000-4000-8000-000000000001') RETURNING id`,
    );
    servicioId = s.id;
    const [cli] = await dataSource.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol)
       VALUES ($1, 'hash', 'Cliente Carga', 'cliente') RETURNING id`,
      [`cliente-carga-${sufijo}@turnos.dev`],
    );
    const [tec] = await dataSource.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol, taller_id)
       VALUES ($1, 'hash', 'Tecnico Carga', 'tecnico', '00000000-0000-4000-8000-000000000001') RETURNING id`,
      [`tecnico-carga-${sufijo}@turnos.dev`],
    );
    [clienteId, tecnicoId] = [cli.id, tec.id];

    const secreto = process.env.JWT_SECRET ?? 'dev-secret-change-me';
    tokenAdmin = jwt.sign(
      {
        sub: clienteId,
        email: 'admin-carga@turnos.dev',
        rol: 'admin',
        taller: TALLER,
      },
      secreto,
    );
    tokenCliente = jwt.sign(
      { sub: clienteId, email: 'cliente-carga@turnos.dev', rol: 'cliente' },
      secreto,
    );

    // Bahia llena, DIA: 2 h atendido + 2 h no asistio + 5 h programado =
    // 540 min (90%, alta). El cancelado de 12 a 13 NO ocupa.
    await turno(
      bahiaLlena,
      local(DIA, '08:00'),
      local(DIA, '10:00'),
      'atendido',
    );
    await turno(
      bahiaLlena,
      local(DIA, '10:00'),
      local(DIA, '12:00'),
      'no_asistio',
    );
    await turno(
      bahiaLlena,
      local(DIA, '12:00'),
      local(DIA, '13:00'),
      'cancelado',
    );
    await turno(
      bahiaLlena,
      local(DIA, '13:00'),
      local(DIA, '18:00'),
      'programado',
    );

    // Bahia de bordes, DIA:
    // - 07:00-09:00 local: arranca antes de la apertura -> cuentan 60 min.
    // - 22:00-23:00 local = 03:00Z-04:00Z del dia siguiente: es del DIA
    //   local (no del siguiente) y queda fuera de la jornada -> 0 min.
    await turno(
      bahiaBordes,
      local(DIA, '07:00'),
      local(DIA, '09:00'),
      'programado',
      false,
    );
    await turno(
      bahiaBordes,
      local(DIA, '22:00'),
      local(DIA, '23:00'),
      'programado',
      false,
    );

    // Una bahia inactiva con turnos no aparece en el panel.
    await turno(
      bahiaInactiva,
      local(DIA, '09:00'),
      local(DIA, '10:00'),
      'programado',
      false,
    );
  });

  afterAll(async () => {
    if (dataSource) {
      await dataSource.query('DELETE FROM turnos WHERE bahia_id = ANY($1)', [
        [bahiaLlena, bahiaBordes, bahiaInactiva],
      ]);
      await dataSource.query('DELETE FROM bahias WHERE id = ANY($1)', [
        [bahiaLlena, bahiaBordes, bahiaInactiva],
      ]);
      await dataSource.query('DELETE FROM servicios WHERE id = $1', [
        servicioId,
      ]);
      await dataSource.query('DELETE FROM usuarios WHERE id = ANY($1)', [
        [clienteId, tecnicoId],
      ]);
    }
    await app?.close();
  });

  async function carga(query: string) {
    const { body } = await request(app.getHttpServer())
      .get(`/bahias/carga?${query}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .set('X-Taller', TALLER)
      .expect(200);
    return body;
  }

  it('calcula turnos y ocupacion por bahia contra la jornada local', async () => {
    const body = await carga(`desde=${DIA}&hasta=${DIA_SIGUIENTE}`);
    const llena = body.bahias.find(
      (b: { bahiaId: string }) => b.bahiaId === bahiaLlena,
    );

    expect(llena.dias).toEqual([
      {
        fecha: DIA,
        turnos: 3,
        minutosOcupados: 540,
        ocupacion: 0.9,
        nivel: 'alta',
      },
      {
        fecha: DIA_SIGUIENTE,
        turnos: 0,
        minutosOcupados: 0,
        ocupacion: 0,
        nivel: 'libre',
      },
    ]);
  });

  it('recorta a la jornada y asigna al dia LOCAL un turno de la noche', async () => {
    const body = await carga(`desde=${DIA}&hasta=${DIA_SIGUIENTE}`);
    const bordes = body.bahias.find(
      (b: { bahiaId: string }) => b.bahiaId === bahiaBordes,
    );

    // El de 07-09 aporta 60 min; el de las 22:00 cuenta como turno del DIA
    // pero no suma minutos (fuera de la jornada). El dia siguiente, vacio.
    expect(bordes.dias[0]).toMatchObject({
      fecha: DIA,
      turnos: 2,
      minutosOcupados: 60,
    });
    expect(bordes.dias[1]).toMatchObject({ fecha: DIA_SIGUIENTE, turnos: 0 });
  });

  it('no lista bahias inactivas', async () => {
    const body = await carga(`desde=${DIA}`);
    expect(
      body.bahias.some((b: { bahiaId: string }) => b.bahiaId === bahiaInactiva),
    ).toBe(false);
  });

  it('marca en el resumen cuantas bahias estan en alerta', async () => {
    const body = await carga(`desde=${DIA}`);
    // Puede haber otras bahias activas (de dev u otros specs) sin turnos ese
    // dia: la llena es la unica en alerta.
    expect(body.resumen[0]).toMatchObject({ fecha: DIA, bahiasEnAlerta: 1 });
  });

  it('el detalle trae los turnos de la bahia en el dia, cancelados incluidos', async () => {
    const { body } = await request(app.getHttpServer())
      .get(`/bahias/${bahiaLlena}/turnos?fecha=${DIA}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .set('X-Taller', TALLER)
      .expect(200);

    expect(body.turnos.map((t: { estado: string }) => t.estado)).toEqual([
      'atendido',
      'no_asistio',
      'cancelado',
      'programado',
    ]);
    expect(body.turnos[0]).toMatchObject({
      inicio: new Date(local(DIA, '08:00')).toISOString(),
      tecnico: { id: tecnicoId, nombre: 'Tecnico Carga' },
      clienteNombre: 'Cliente Carga',
      servicio: { nombre: 'Servicio carga test', categoria: 'mecanica' },
    });
  });

  it('401 sin token, 403 sin rol admin', async () => {
    await request(app.getHttpServer()).get('/bahias/carga').expect(401);
    await request(app.getHttpServer())
      .get('/bahias/carga')
      .set('Authorization', `Bearer ${tokenCliente}`)
      .set('X-Taller', TALLER)
      .expect(403);
  });

  it('404 para una bahia inexistente, 400 para un id que no es UUID', async () => {
    await request(app.getHttpServer())
      .get('/bahias/00000000-0000-4000-8000-0000000000ff/turnos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .set('X-Taller', TALLER)
      .expect(404);
    await request(app.getHttpServer())
      .get('/bahias/no-es-uuid/turnos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .set('X-Taller', TALLER)
      .expect(400);
  });

  it('400 para un rango invertido o mayor a 31 dias', async () => {
    for (const q of [
      `desde=${DIA_SIGUIENTE}&hasta=${DIA}`,
      'desde=2019-01-01&hasta=2019-03-01',
    ]) {
      await request(app.getHttpServer())
        .get(`/bahias/carga?${q}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .set('X-Taller', TALLER)
        .expect(400);
    }
  });
});
