import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '@turnos-platform/http';

// Mismo criterio que los specs de integracion de reservas-service: necesita
// una Postgres real y se salta si no hay DATABASE_URL.
//
// POR QUE EXISTE ESTE ARCHIVO
//
// Hasta Sprint 10, usuarios-service no tenia ningun test que levantara
// AppModule contra una base de verdad. Los unitarios mockean el repositorio,
// asi que nunca se ejecutaba DataSource.initialize() -- y ahi es donde
// TypeORM valida el mapeo de las entidades.
//
// El resultado fue un bug latente: `Usuario.telefono` estaba declarado como
// `@Column({ nullable: true })` sobre un tipo `string | null`. TypeScript
// emite `Object` como metadato para una union, TypeORM no sabe mapear Object
// a Postgres, y aborta al inicializar. O sea: el servicio NO ARRANCABA, y
// toda la suite unitaria seguia en verde. El mismo error tumbo a
// reservas-service en CI desde Sprint 6.
//
// El test mas barato que cierra esa clase entera de fallas es simplemente
// arrancar la aplicacion de verdad.
const DATABASE_URL = process.env.DATABASE_URL;
const describirSiHayDb = DATABASE_URL ? describe : describe.skip;

if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    'DATABASE_URL no esta seteada: se omite usuarios.integration-spec.ts. ' +
      'Ver packages/database/README.md para levantar una Postgres local.',
  );
}

describirSiHayDb('Usuarios (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    dataSource = moduleRef.get(DataSource);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('arranca y mapea todas sus entidades contra Postgres', () => {
    // Llegar hasta aca ya es la mitad del test: si alguna entidad tuviera un
    // tipo de columna que TypeORM no sabe mapear, el beforeAll habria
    // explotado en DataSource.initialize().
    expect(dataSource.isInitialized).toBe(true);

    const usuario = dataSource.getMetadata('usuarios');
    const telefono = usuario.findColumnWithPropertyName('telefono');
    expect(telefono).toBeDefined();
    // La regresion concreta: el tipo tiene que estar declarado, no deducido.
    expect(telefono!.type).toBe('text');
  });

  it('el readiness reporta que alcanza Postgres', async () => {
    const { body } = await request(app.getHttpServer())
      .get('/usuarios/health/ready')
      .expect(200);

    expect(body).toEqual({
      status: 'ok',
      module: 'usuarios',
      dependencias: { postgres: { status: 'up' } },
    });
  });

  it('rechaza credenciales invalidas con 401 y el formato de error comun', async () => {
    const { body } = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'no-existe@turnos.dev', password: 'password-cualquiera' })
      .expect(401);

    expect(body.message).toMatch(/credenciales/i);
    // requestId lo agrega HttpExceptionFilter: es lo que permite cruzar un
    // reporte de un usuario con una linea de log concreta.
    expect(body.requestId).toEqual(expect.any(String));
    expect(body.path).toBe('/auth/login');
  });

  it('rechaza un body que no pasa la validacion, con 400', async () => {
    const { body } = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'no-es-un-email', password: 'corta' })
      .expect(400);

    // El ValidationPipe devuelve un array de mensajes; el filtro global lo
    // preserva en vez de aplanarlo a un string.
    expect(Array.isArray(body.message)).toBe(true);
  });
});
