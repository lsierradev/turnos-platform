import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as jwt from 'jsonwebtoken';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

// Mismo criterio que appointments.integration-spec.ts: necesita una Postgres
// real con las migraciones aplicadas y se salta si no hay DATABASE_URL.
//
// Los unit tests de DashboardService mockean DataSource, asi que verifican la
// aritmetica de los KPIs pero NO el SQL: un error de sintaxis, un nombre de
// columna mal escrito o un predicado que no matchea el indice pasarian
// invisibles. Eso es lo que cubre este archivo.
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
    'DATABASE_URL no esta seteada: se omite dashboard.integration-spec.ts. ' +
      'Ver packages/database/README.md para levantar una Postgres local.',
  );
}

describirSiHayDb('Dashboard KPIs (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let bahiaId: string;
  let servicioId: string;
  let usuarioId: string;
  let tecnicoId: string;
  let token: string;

  // Fechas fijas y lejanas en el pasado: el rango consultado tiene que
  // contener SOLO las filas que siembra este test, sin que lo ensucien
  // turnos que hayan dejado otros specs de integracion.
  const DIA_1 = '2019-03-04';
  const DIA_2 = '2019-03-05';
  // Par aparte para el corte de medianoche, separado de DIA_1/DIA_2 para no
  // tocar los totales de los otros tests.
  const DIA_NOCHE = '2019-03-07';
  const DIA_NOCHE_SIGUIENTE = '2019-03-08';

  async function insertarTurno(
    dia: string,
    hora: number,
    estado: string,
    minutosAtencion?: number,
  ) {
    // Hora de pared de Bogota (TZ_NEGOCIO por defecto, UTC-5 sin DST).
    const inicio = `${dia}T${String(hora).padStart(2, '0')}:00:00-05:00`;
    const fin = `${dia}T${String(hora + 1).padStart(2, '0')}:00:00-05:00`;

    const atencionInicio = minutosAtencion === undefined ? null : inicio;
    const atencionFin =
      minutosAtencion === undefined
        ? null
        : new Date(
            new Date(inicio).getTime() + minutosAtencion * 60_000,
          ).toISOString();

    await dataSource.query(
      `INSERT INTO turnos
         (taller_id, bahia_id, servicio_id, usuario_id, tecnico_id, rango_tiempo,
          estado, atencion_inicio, atencion_fin)
       VALUES ('00000000-0000-4000-8000-000000000001', $1, $2, $3, $4, tstzrange($5::timestamptz, $6::timestamptz, '[)'),
               $7::estado_turno, $8::timestamptz, $9::timestamptz)`,
      [
        bahiaId,
        servicioId,
        usuarioId,
        tecnicoId,
        inicio,
        fin,
        estado,
        atencionInicio,
        atencionFin,
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

    const bahia = await dataSource.query(
      "INSERT INTO bahias (nombre, taller_id) VALUES ('Bahia dashboard test', '00000000-0000-4000-8000-000000000001') RETURNING id",
    );
    bahiaId = bahia[0].id;

    const servicio = await dataSource.query(
      `INSERT INTO servicios (nombre, categoria, duracion_minutos, precio_base_centavos, taller_id)
       VALUES ('Servicio dashboard test', 'mecanica', 60, 10000, '00000000-0000-4000-8000-000000000001')
       RETURNING id`,
    );
    servicioId = servicio[0].id;

    const usuario = await dataSource.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol)
       VALUES ('dashboard-test@turnos.dev', 'hash', 'Dashboard Test', 'cliente')
       RETURNING id`,
    );
    usuarioId = usuario[0].id;

    const tecnico = await dataSource.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol, taller_id)
       VALUES ('tecnico-dashboard-test@turnos.dev', 'hash', 'Tecnico Dashboard', 'tecnico', '00000000-0000-4000-8000-000000000001')
       RETURNING id`,
    );
    tecnicoId = tecnico[0].id;

    token = jwt.sign(
      {
        sub: usuarioId,
        email: 'dashboard-test@turnos.dev',
        rol: 'admin',
        taller: TALLER,
      },
      process.env.JWT_SECRET ?? 'dev-secret-change-me',
    );

    // DIA_1: 3 atendidos (30, 50 y 40 min medidos) + 1 no_asistio
    //        -> tasa 75%, promedio 40 min
    await insertarTurno(DIA_1, 8, 'atendido', 30);
    await insertarTurno(DIA_1, 10, 'atendido', 50);
    await insertarTurno(DIA_1, 12, 'atendido', 40);
    await insertarTurno(DIA_1, 14, 'no_asistio');
    // DIA_2: 1 atendido SIN medicion + 1 cancelado + 1 programado
    //        -> tasa 100%, promedio null (nada medido)
    await insertarTurno(DIA_2, 9, 'atendido');
    await insertarTurno(DIA_2, 11, 'cancelado');
    await insertarTurno(DIA_2, 13, 'programado');

    // 22:00 locales de DIA_NOCHE = 03:00Z de DIA_NOCHE_SIGUIENTE.
    await insertarTurno(DIA_NOCHE, 22, 'atendido');
  });

  afterAll(async () => {
    if (dataSource) {
      await dataSource.query('DELETE FROM turnos WHERE bahia_id = $1', [
        bahiaId,
      ]);
      await dataSource.query('DELETE FROM servicios WHERE id = $1', [
        servicioId,
      ]);
      await dataSource.query('DELETE FROM bahias WHERE id = $1', [bahiaId]);
      await dataSource.query('DELETE FROM usuarios WHERE id = $1 OR id = $2', [
        usuarioId,
        tecnicoId,
      ]);
    }
    await app?.close();
  });

  it('calcula los KPIs del periodo contra datos reales', async () => {
    const { body } = await request(app.getHttpServer())
      .get(`/dashboard/kpis?from=${DIA_1}&to=${DIA_2}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Taller', TALLER)
      .expect(200);

    // 4 atendidos / (4 atendidos + 1 no_asistio) = 0.8. El cancelado y el
    // programado NO entran en el denominador.
    expect(body.resumen.tasaAsistencia).toBeCloseTo(0.8, 5);
    expect(body.resumen.turnosAtendidos).toBe(4);
    expect(body.resumen.turnosNoAsistio).toBe(1);
    expect(body.resumen.turnosCancelados).toBe(1);
    expect(body.resumen.turnosProgramados).toBe(1);
    expect(body.resumen.turnosTotales).toBe(7);

    // (30 + 50 + 40) / 3 = 40 min, sobre los 3 turnos CON medicion (el
    // cuarto atendido no tiene horas cargadas y queda fuera del promedio).
    expect(body.resumen.minutosPromedioServicio).toBeCloseTo(40, 5);
    expect(body.resumen.turnosMedidos).toBe(3);
  });

  it('un turno de la noche local cuenta para ese dia, no para el dia UTC siguiente', async () => {
    const server = app.getHttpServer();

    const { body: noche } = await request(server)
      .get(`/dashboard/kpis?from=${DIA_NOCHE}&to=${DIA_NOCHE}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Taller', TALLER)
      .expect(200);
    const { body: siguiente } = await request(server)
      .get(
        `/dashboard/kpis?from=${DIA_NOCHE_SIGUIENTE}&to=${DIA_NOCHE_SIGUIENTE}`,
      )
      .set('Authorization', `Bearer ${token}`)
      .set('X-Taller', TALLER)
      .expect(200);

    expect(noche.resumen.turnosAtendidos).toBe(1);
    expect(noche.serie[0].atendidos).toBe(1);
    expect(siguiente.resumen.turnosTotales).toBe(0);
  });

  it('agrupa por dia de la zona de negocio, sin depender del TimeZone del servidor', async () => {
    const { body } = await request(app.getHttpServer())
      .get(`/dashboard/kpis?from=${DIA_1}&to=${DIA_2}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Taller', TALLER)
      .expect(200);

    expect(body.serie.map((d: { fecha: string }) => d.fecha)).toEqual([
      DIA_1,
      DIA_2,
    ]);

    const [dia1, dia2] = body.serie;
    expect(dia1.tasaAsistencia).toBeCloseTo(0.75, 5);
    expect(dia1.minutosPromedioServicio).toBeCloseTo(40, 5);
    expect(dia2.tasaAsistencia).toBeCloseTo(1, 5);
    // Un dia con turnos atendidos pero ninguno cronometrado da null, no 0:
    // "no se midio" y "duro 0 minutos" no son lo mismo.
    expect(dia2.minutosPromedioServicio).toBeNull();
  });

  it('el filtro por fecha puede resolverse con idx_turnos_kpi_inicio', async () => {
    // El objetivo de esta prueba es la TAREA 3 de RF-04: que el predicado de
    // la consulta sea sargable contra el indice de 009 y no fuerce un seq
    // scan de la tabla caliente de reservas.
    //
    // Con la poca cantidad de filas de un test, el planner elige un seq scan
    // de todas formas (es mas barato leer la tabla entera que pasar por el
    // indice), asi que afirmar "el plan real usa el indice" seria afirmar
    // algo falso. Lo que se verifica es lo que si esta bajo control del
    // codigo: que el indice SEA UTILIZABLE para este predicado. Si alguien
    // envuelve lower(rango_tiempo) en una conversion -- p. ej. mueve el
    // AT TIME ZONE del GROUP BY al WHERE -- el indice deja de aplicar
    // y este test falla aunque los numeros sigan dando bien.
    // El SET LOCAL va en su propio query() dentro de una transaccion: el
    // protocolo extendido de Postgres (el que usa el driver cuando hay
    // parametros) admite una sola sentencia por llamada.
    const plan = await dataSource.transaction(async (manager) => {
      await manager.query('SET LOCAL enable_seqscan = off');
      return manager.query(
        `EXPLAIN (FORMAT JSON)
         SELECT count(*) FILTER (WHERE estado = 'atendido')
         FROM turnos
         WHERE lower(rango_tiempo) >= $1 AND lower(rango_tiempo) < $2`,
        [`${DIA_1}T00:00:00.000Z`, `${DIA_2}T00:00:00.000Z`],
      );
    });

    expect(JSON.stringify(plan)).toContain('idx_turnos_kpi_inicio');
  });
});
