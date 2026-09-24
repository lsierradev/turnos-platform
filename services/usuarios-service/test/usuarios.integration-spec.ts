import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createHash, randomBytes } from 'crypto';
import * as jwt from 'jsonwebtoken';
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
  let adminId: string;
  let clienteId: string;
  let adminToken: string;
  let clienteToken: string;

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

    const admin = await dataSource.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol)
       VALUES ('admin-integration-test@turnos.dev', 'hash', 'Admin Integration Test', 'admin')
       RETURNING id`,
    );
    adminId = admin[0].id;

    const cliente = await dataSource.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol)
       VALUES ('cliente-integration-test@turnos.dev', 'hash', 'Cliente Integration Test', 'cliente')
       RETURNING id`,
    );
    clienteId = cliente[0].id;

    const secret = process.env.JWT_SECRET ?? 'dev-secret-change-me';
    adminToken = jwt.sign(
      {
        sub: adminId,
        email: 'admin-integration-test@turnos.dev',
        rol: 'admin',
      },
      secret,
    );
    clienteToken = jwt.sign(
      {
        sub: clienteId,
        email: 'cliente-integration-test@turnos.dev',
        rol: 'cliente',
      },
      secret,
    );
  });

  afterAll(async () => {
    if (dataSource) {
      await dataSource.query(
        `DELETE FROM usuarios WHERE id = $1 OR id = $2 OR email = ANY($3)`,
        [
          adminId,
          clienteId,
          [
            'creado-por-integration-test@turnos.dev',
            'invitado-integration-test@turnos.dev',
          ],
        ],
      );
    }
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

  describe('POST /usuarios', () => {
    it('rechaza sin token con 401', async () => {
      await request(app.getHttpServer())
        .post('/usuarios')
        .send({
          email: 'sin-token@turnos.dev',
          password: 'password123',
          nombre: 'Sin Token',
        })
        .expect(401);
    });

    it('rechaza a un usuario sin rol admin con 403', async () => {
      await request(app.getHttpServer())
        .post('/usuarios')
        .set('Authorization', `Bearer ${clienteToken}`)
        .send({
          email: 'rechazado@turnos.dev',
          password: 'password123',
          nombre: 'Rechazado',
        })
        .expect(403);
    });

    it('crea un usuario cuando lo pide un admin, sin exponer el hash', async () => {
      const { body } = await request(app.getHttpServer())
        .post('/usuarios')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'creado-por-integration-test@turnos.dev',
          password: 'password123',
          nombre: 'Creado Por Test',
          rol: 'tecnico',
        })
        .expect(201);

      expect(body.email).toBe('creado-por-integration-test@turnos.dev');
      expect(body.rol).toBe('tecnico');
      expect(body.passwordHash).toBeUndefined();
    });
  });

  describe('GET /usuarios', () => {
    it('rechaza sin token con 401', async () => {
      await request(app.getHttpServer()).get('/usuarios').expect(401);
    });

    it('filtra por rol cuando lo pide un admin', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/usuarios')
        .query({ rol: 'admin' })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(body)).toBe(true);
      expect(
        body.every((usuario: { rol: string }) => usuario.rol === 'admin'),
      ).toBe(true);
      expect(
        body.every(
          (usuario: { passwordHash?: string }) => !usuario.passwordHash,
        ),
      ).toBe(true);
    });
  });

  describe('contrasena por correo (Sprint 18)', () => {
    const email = 'invitado-integration-test@turnos.dev';

    it('un alta sin password nace con una contrasena al azar y un enlace de alta', async () => {
      const { body } = await request(app.getHttpServer())
        .post('/usuarios')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email, nombre: 'Invitado', ciudad: 'Cali' })
        .expect(201);

      expect(body.ciudad).toBe('Cali');
      // Sin SendGrid en el entorno de test el correo queda en el log.
      expect(body.invitacion).toEqual({ enviado: false });

      const tokens = await dataSource.query(
        'SELECT motivo, usado_en, expira_en FROM tokens_contrasena WHERE usuario_id = $1',
        [body.id],
      );
      expect(tokens).toHaveLength(1);
      expect(tokens[0].motivo).toBe('alta');
      expect(tokens[0].usado_en).toBeNull();

      // Nadie conoce la contrasena inicial: ni una vacia ni una obvia entran.
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'password123' })
        .expect(401);
    });

    it('el enlace define la contrasena una sola vez y despues se puede entrar', async () => {
      // El token real solo viaja por correo: el test siembra uno propio con
      // su hash, igual que lo guarda el servicio.
      const token = randomBytes(32).toString('base64url');
      const [{ id }] = await dataSource.query(
        'SELECT id FROM usuarios WHERE email = $1',
        [email],
      );
      await dataSource.query(
        `INSERT INTO tokens_contrasena (usuario_id, token_hash, motivo, expira_en)
         VALUES ($1, $2, 'alta', now() + interval '1 hour')`,
        [id, createHash('sha256').update(token).digest('hex')],
      );

      await request(app.getHttpServer())
        .post('/auth/restablecer')
        .send({ token, password: 'mi-clave-nueva' })
        .expect(204);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'mi-clave-nueva' })
        .expect(200);

      // Usado: no sirve una segunda vez.
      await request(app.getHttpServer())
        .post('/auth/restablecer')
        .send({ token, password: 'otra-clave-123' })
        .expect(400);
    });

    it('olvide responde igual exista o no el correo, y frena los pedidos seguidos', async () => {
      // Los enlaces de los tests anteriores son de hace segundos: dentro del
      // freno de 1 minuto entre pedidos.
      await dataSource.query(
        `UPDATE tokens_contrasena SET creado_en = now() - interval '5 minutes'
          WHERE usuario_id = (SELECT id FROM usuarios WHERE email = $1)`,
        [email],
      );

      await request(app.getHttpServer())
        .post('/auth/olvide')
        .send({ email: 'nadie-integration@turnos.dev' })
        .expect(202);
      await request(app.getHttpServer())
        .post('/auth/olvide')
        .send({ email })
        .expect(202);
      // El segundo pedido inmediato tambien da 202, pero no genera otro.
      await request(app.getHttpServer())
        .post('/auth/olvide')
        .send({ email })
        .expect(202);

      const [{ n }] = await dataSource.query(
        `SELECT count(*)::int AS n FROM tokens_contrasena t
           JOIN usuarios u ON u.id = t.usuario_id
          WHERE u.email = $1 AND t.motivo = 'olvido'`,
        [email],
      );
      expect(n).toBe(1);
    });
  });
});
