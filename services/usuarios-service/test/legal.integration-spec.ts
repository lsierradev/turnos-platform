import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { HttpExceptionFilter } from '@turnos-platform/http';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import * as jwt from 'jsonwebtoken';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { CATALOGO, versionVigente } from '../src/modules/legal/catalogo';

// Documentos legales, aceptaciones y derechos del titular (Sprint 23),
// contra una Postgres real con RLS. Se salta sin DATABASE_URL.
const DATABASE_URL = process.env.DATABASE_URL;
const describirSiHayDb = DATABASE_URL ? describe : describe.skip;

const PASSWORD = 'clave-legal-123';

/** Condiciones publicables: largas y sin marcas pendientes. */
const condiciones = (n: number) =>
  `# Condiciones del Taller Legal (${n})\n\n` +
  'Los precios incluyen IVA. El anticipo se entrega como arras y se devuelve ' +
  'completo si cancela con al menos 4 horas de anticipacion o si el taller ' +
  'cancela. Fuera de esa ventana se registra un strike, que vence a los 12 ' +
  'meses y se puede reclamar desde Mi perfil.\n';

describirSiHayDb('Legal y derechos del titular (integration)', () => {
  let app: INestApplication;
  let db: DataSource;
  const sufijo = randomBytes(4).toString('hex');
  let taller: string;
  let otroTaller: string;
  let adminId: string;
  let otroAdminId: string;
  let clienteId: string;
  let tokenAdmin: string;
  let tokenOtroAdmin: string;
  let tokenCliente: string;
  let tokenSuper: string;

  const secreto = () => process.env.JWT_SECRET ?? 'dev-secret-change-me';
  const firmar = (p: object) => jwt.sign(p, secreto());
  const http = () => request(app.getHttpServer());

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
    db = moduleRef.get(DataSource);

    const hash = await bcrypt.hash(PASSWORD, 4);
    const crearTaller = async (slug: string) =>
      (
        await db.query(
          'INSERT INTO talleres (nombre, slug) VALUES ($1, $2) RETURNING id',
          [`Taller ${slug}`, slug],
        )
      )[0].id as string;
    taller = await crearTaller(`legal-${sufijo}`);
    otroTaller = await crearTaller(`legal-otro-${sufijo}`);

    const crearUsuario = async (
      nombre: string,
      rol: string,
      tallerId: string | null,
    ) =>
      (
        await db.query(
          `INSERT INTO usuarios (email, password_hash, nombre, rol, taller_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [`${nombre}-${sufijo}@turnos.dev`, hash, nombre, rol, tallerId],
        )
      )[0].id as string;
    adminId = await crearUsuario('admin-legal', 'admin', taller);
    otroAdminId = await crearUsuario('admin2-legal', 'admin', taller);
    clienteId = await crearUsuario('cliente-legal', 'cliente', null);
    await db.query(
      'INSERT INTO clientes_taller (taller_id, usuario_id) VALUES ($1, $2)',
      [taller, clienteId],
    );
    const superId = await crearUsuario('super-legal', 'superadmin', null);

    tokenAdmin = firmar({ sub: adminId, email: 'a', rol: 'admin', taller });
    tokenOtroAdmin = firmar({
      sub: otroAdminId,
      email: 'a2',
      rol: 'admin',
      taller,
    });
    tokenCliente = firmar({ sub: clienteId, email: 'c', rol: 'cliente' });
    tokenSuper = firmar({ sub: superId, email: 's', rol: 'superadmin' });
  });

  afterAll(async () => {
    if (db) {
      await db.query('DELETE FROM turnos WHERE taller_id = ANY($1)', [
        [taller, otroTaller],
      ]);
      await db.query(
        `DELETE FROM usuarios
          WHERE taller_id = ANY($1) OR email LIKE $2
             OR id IN (SELECT usuario_id FROM clientes_taller WHERE taller_id = ANY($1))`,
        [[taller, otroTaller], `%-${sufijo}@turnos.dev`],
      );
      await db.query('DELETE FROM usuarios WHERE id = $1', [clienteId]);
      // Bahias y servicios no caen en cascada con el taller.
      for (const tabla of ['servicios', 'bahias']) {
        await db.query(`DELETE FROM ${tabla} WHERE taller_id = ANY($1)`, [
          [taller, otroTaller],
        ]);
      }
      await db.query('DELETE FROM talleres WHERE id = ANY($1)', [
        [taller, otroTaller],
      ]);
    }
    await app?.close();
  });

  describe('documentos publicos', () => {
    it('lista los vigentes sin sesion y sin el texto', async () => {
      const { body } = await http().get('/legal/documentos').expect(200);
      expect(body.map((d: { documento: string }) => d.documento)).toEqual([
        'terminos_taller',
        'politica_datos',
        'autorizacion_datos',
      ]);
      expect(body[0].contenido).toBeUndefined();
    });

    it('sirve el texto de una version, con su hash', async () => {
      const { body } = await http()
        .get('/legal/documentos/politica_datos')
        .query({ version: 1 })
        .expect(200);
      expect(body.contenido).toMatch(/Ley 1581 de 2012/);
      expect(body.sha256).toBe(CATALOGO.politica_datos.versiones[0].sha256);
      await http()
        .get('/legal/documentos/politica_datos')
        .query({ version: 99 })
        .expect(404);
      await http().get('/legal/documentos/otra_cosa').expect(400);
    });
  });

  describe('pendientes y aceptaciones', () => {
    it('cada rol ve lo suyo: el superadmin no acepta nada', async () => {
      const cliente = await http()
        .get('/legal/pendientes')
        .set('Authorization', `Bearer ${tokenCliente}`)
        .expect(200);
      expect(
        cliente.body.map((d: { documento: string }) => d.documento),
      ).toEqual(['politica_datos', 'autorizacion_datos']);
      const admin = await http()
        .get('/legal/pendientes')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200);
      expect(admin.body).toHaveLength(3);
      const superadmin = await http()
        .get('/legal/pendientes')
        .set('Authorization', `Bearer ${tokenSuper}`)
        .expect(200);
      expect(superadmin.body).toEqual([]);
    });

    it('guarda usuario, version, hash, fecha, IP y canal', async () => {
      const version = versionVigente('politica_datos').version;
      const { body } = await http()
        .post('/legal/aceptaciones')
        .set('Authorization', `Bearer ${tokenCliente}`)
        .set('User-Agent', 'prueba-integracion')
        .send({ documento: 'politica_datos', version })
        .expect(201);
      expect(body).toMatchObject({
        documento: 'politica_datos',
        version,
        canal: 'web',
        tallerId: null,
      });
      const [fila] = await db.query(
        `SELECT usuario_id, sha256, host(ip) AS ip, user_agent, aceptado_en
           FROM aceptaciones_legales WHERE id = $1`,
        [body.id],
      );
      expect(fila.usuario_id).toBe(clienteId);
      expect(fila.sha256).toBe(versionVigente('politica_datos').sha256);
      expect(fila.ip).toEqual(expect.any(String));
      expect(fila.user_agent).toBe('prueba-integracion');
      expect(fila.aceptado_en).toBeInstanceOf(Date);
    });

    it('rechaza aceptar una version que no es la vigente', async () => {
      const { body } = await http()
        .post('/legal/aceptaciones')
        .set('Authorization', `Bearer ${tokenCliente}`)
        .send({ documento: 'autorizacion_datos', version: 99 })
        .expect(409);
      expect(body.versionVigente).toBe(
        versionVigente('autorizacion_datos').version,
      );
    });

    it('una version nueva vuelve a pedir la aceptacion', async () => {
      await http()
        .post('/legal/aceptaciones')
        .set('Authorization', `Bearer ${tokenCliente}`)
        .send({ documento: 'autorizacion_datos', version: 1 })
        .expect(201);
      const alDia = await http()
        .get('/legal/pendientes')
        .set('Authorization', `Bearer ${tokenCliente}`)
        .expect(200);
      expect(alDia.body).toEqual([]);

      // Se publica la version 2 de la politica (en memoria, para la prueba).
      const versiones = CATALOGO.politica_datos.versiones;
      versiones.push({ ...versiones[0], version: 2 });
      try {
        const { body } = await http()
          .get('/legal/pendientes')
          .set('Authorization', `Bearer ${tokenCliente}`)
          .expect(200);
        expect(body).toHaveLength(1);
        expect(body[0]).toMatchObject({
          documento: 'politica_datos',
          version: 2,
        });
      } finally {
        versiones.pop();
      }
    });

    it('los terminos los acepta un admin por su taller, y valen para los otros admins', async () => {
      await http()
        .post('/legal/aceptaciones')
        .set('Authorization', `Bearer ${tokenCliente}`)
        .set('X-Taller', taller)
        .send({ documento: 'terminos_taller', version: 1 })
        .expect(403);

      const { body } = await http()
        .post('/legal/aceptaciones')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ documento: 'terminos_taller', version: 1 })
        .expect(201);
      expect(body.tallerId).toBe(taller);

      const otro = await http()
        .get('/legal/pendientes')
        .set('Authorization', `Bearer ${tokenOtroAdmin}`)
        .expect(200);
      expect(
        otro.body.map((d: { documento: string }) => d.documento),
      ).not.toContain('terminos_taller');
    });

    it('la app no puede modificar ni borrar una aceptacion', async () => {
      await db.transaction(async (m) => {
        await m.query('SET LOCAL ROLE turnos_app');
        await expect(
          m.query(
            "UPDATE aceptaciones_legales SET version = 7 WHERE documento = 'terminos_taller'",
          ),
        ).rejects.toThrow(/permission denied|permiso denegado/i);
      });
    });
  });

  describe('alta de un cliente en el mostrador', () => {
    const email = `mostrador-${sufijo}@turnos.dev`;

    it('exige que el admin confirme la autorizacion de datos', async () => {
      await http()
        .post('/usuarios')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ email, nombre: 'Cliente Mostrador', ciudad: 'Cali' })
        .expect(400);
    });

    it('la deja registrada como presencial, a nombre del admin', async () => {
      const { body } = await http()
        .post('/usuarios')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          email,
          nombre: 'Cliente Mostrador',
          ciudad: 'Cali',
          autorizacionDatos: true,
        })
        .expect(201);
      const filas = await db.query(
        `SELECT documento, canal, registrado_por, taller_id
           FROM aceptaciones_legales WHERE usuario_id = $1 ORDER BY documento`,
        [body.id],
      );
      expect(filas).toEqual([
        {
          documento: 'autorizacion_datos',
          canal: 'presencial',
          registrado_por: adminId,
          taller_id: taller,
        },
        {
          documento: 'politica_datos',
          canal: 'presencial',
          registrado_por: adminId,
          taller_id: taller,
        },
      ]);

      // La constancia del mostrador no reemplaza la del titular: en su
      // primer ingreso igual se le piden.
      const tokenNuevo = firmar({ sub: body.id, email, rol: 'cliente' });
      const pendientes = await http()
        .get('/legal/pendientes')
        .set('Authorization', `Bearer ${tokenNuevo}`)
        .expect(200);
      expect(pendientes.body).toHaveLength(2);
    });
  });

  describe('condiciones del taller', () => {
    it('el borrador parte de la plantilla con los datos del taller', async () => {
      const { body } = await http()
        .get('/legal/condiciones/borrador')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200);
      expect(body.basadoEn).toBe('plantilla');
      expect(body.contenido).toContain(`Taller legal-${sufijo}`);
      expect(body.contenido).toContain('hasta 4 horas antes');
      // Sin datos fiscales cargados: faltan razon social, NIT...
      expect(body.pendientes).toEqual(
        expect.arrayContaining(['⟦COMPLETAR: razón social⟧']),
      );
    });

    it('no publica con marcas pendientes', async () => {
      const { body } = await http()
        .get('/legal/condiciones/borrador')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      const rechazo = await http()
        .post('/legal/condiciones')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ contenido: body.contenido })
        .expect(400);
      expect(rechazo.body.pendientes.length).toBeGreaterThan(0);
    });

    it('sin condiciones publicadas no hay nada que aceptar', async () => {
      const { body } = await http()
        .get('/legal/condiciones/estado')
        .set('Authorization', `Bearer ${tokenCliente}`)
        .set('X-Taller', taller)
        .expect(200);
      expect(body).toEqual({ vigente: null, aceptada: true });
    });

    it('publica versiones y cada una se vuelve a aceptar', async () => {
      const v1 = await http()
        .post('/legal/condiciones')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ contenido: condiciones(1) })
        .expect(201);
      expect(v1.body).toMatchObject({ version: 1, tallerId: taller });

      await http()
        .post('/legal/condiciones')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ contenido: condiciones(1) })
        .expect(409);

      const antes = await http()
        .get('/legal/condiciones/estado')
        .set('Authorization', `Bearer ${tokenCliente}`)
        .set('X-Taller', taller)
        .expect(200);
      expect(antes.body.aceptada).toBe(false);

      await http()
        .post('/legal/aceptaciones')
        .set('Authorization', `Bearer ${tokenCliente}`)
        .set('X-Taller', taller)
        .send({ documento: 'condiciones_taller', version: 1 })
        .expect(201);

      const despues = await http()
        .get('/legal/condiciones/estado')
        .set('Authorization', `Bearer ${tokenCliente}`)
        .set('X-Taller', taller)
        .expect(200);
      expect(despues.body.aceptada).toBe(true);

      await http()
        .post('/legal/condiciones')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ contenido: condiciones(2) })
        .expect(201);
      const conV2 = await http()
        .get('/legal/condiciones/estado')
        .set('Authorization', `Bearer ${tokenCliente}`)
        .set('X-Taller', taller)
        .expect(200);
      expect(conV2.body).toMatchObject({
        aceptada: false,
        vigente: { version: 2 },
      });

      // El admin lo ve por el cliente y deja constancia en el mostrador.
      await http()
        .post('/legal/aceptaciones/presenciales')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ clienteId, documentos: ['condiciones_taller'] })
        .expect(201);
      const porAdmin = await http()
        .get('/legal/condiciones/estado')
        .query({ clienteId })
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200);
      expect(porAdmin.body.aceptada).toBe(true);

      const versiones = await http()
        .get('/legal/condiciones/versiones')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200);
      expect(
        versiones.body.map((v: { version: number; aceptaciones: number }) => [
          v.version,
          v.aceptaciones,
        ]),
      ).toEqual([
        [2, 1],
        [1, 1],
      ]);
    });

    it('son publicas y cada version se puede consultar tal cual', async () => {
      const { body } = await http()
        .get(`/legal/talleres/${taller}/condiciones`)
        .query({ version: 1 })
        .expect(200);
      expect(body.contenido).toBe(condiciones(1));
      await http().get(`/legal/talleres/${otroTaller}/condiciones`).expect(404);
    });

    it('un admin no registra aceptaciones de un cliente de otro taller', async () => {
      const ajeno = firmar({
        sub: adminId,
        email: 'a',
        rol: 'admin',
        taller: otroTaller,
      });
      await http()
        .post('/legal/aceptaciones/presenciales')
        .set('Authorization', `Bearer ${ajeno}`)
        .send({ clienteId, documentos: ['politica_datos'] })
        .expect(404);
    });
  });

  describe('derechos del titular', () => {
    it('consulta sus datos y sus aceptaciones', async () => {
      const { body } = await http()
        .get('/mis-datos')
        .set('Authorization', `Bearer ${tokenCliente}`)
        .expect(200);
      expect(body.perfil).toMatchObject({ id: clienteId, rol: 'cliente' });
      expect(body.aceptaciones.length).toBeGreaterThanOrEqual(3);
      expect(body.supresion).toEqual({ posible: true, motivo: null });
    });

    it('rectifica nombre, telefono y ciudad, y deja traza sin los valores', async () => {
      const { body } = await http()
        .patch('/mis-datos')
        .set('Authorization', `Bearer ${tokenCliente}`)
        .send({
          nombre: 'Cliente Corregido',
          telefono: '3001234567',
          ciudad: 'Medellin',
        })
        .expect(200);
      expect(body).toMatchObject({
        nombre: 'Cliente Corregido',
        telefono: '3001234567',
        ciudad: 'Medellin',
      });
      const [crudo] = await db.query(
        'SELECT telefono FROM usuarios WHERE id = $1',
        [clienteId],
      );
      expect(crudo.telefono).not.toBe('3001234567'); // cifrado en reposo
      const [solicitud] = await db.query(
        `SELECT detalle FROM solicitudes_titular
          WHERE usuario_id = $1 AND tipo = 'rectificacion'`,
        [clienteId],
      );
      expect(solicitud.detalle).toEqual({
        campos: ['nombre', 'telefono', 'ciudad'],
      });
    });

    it('exporta todo en un archivo JSON', async () => {
      const res = await http()
        .get('/mis-datos/exportar')
        .set('Authorization', `Bearer ${tokenCliente}`)
        .expect(200);
      expect(res.headers['content-disposition']).toMatch(
        /attachment; filename="mis-datos-turnopro-/,
      );
      expect(res.body.perfil.nombre).toBe('Cliente Corregido');
      for (const clave of [
        'vehiculos',
        'turnos',
        'recepciones',
        'strikes',
        'notificaciones',
        'aceptaciones',
        'solicitudes',
      ]) {
        expect(Array.isArray(res.body[clave])).toBe(true);
      }
    });

    it('el personal no suprime su cuenta desde aca', async () => {
      await http()
        .post('/mis-datos/suprimir')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ password: PASSWORD })
        .expect(403);
    });

    describe('supresion', () => {
      let bahia: string;
      let servicio: string;
      let vehiculoConTurno: string;
      let turnoFuturo: string;

      beforeAll(async () => {
        [{ id: bahia }] = await db.query(
          "INSERT INTO bahias (nombre, taller_id) VALUES ('B legal', $1) RETURNING id",
          [taller],
        );
        [{ id: servicio }] = await db.query(
          `INSERT INTO servicios (nombre, categoria, duracion_minutos, precio_base_centavos, taller_id)
           VALUES ('Aceite legal', 'mecanica', 60, 5000000, $1) RETURNING id`,
          [taller],
        );
        [{ id: vehiculoConTurno }] = await db.query(
          `INSERT INTO vehiculos (usuario_id, placa, marca, modelo, anio, kilometraje)
           VALUES ($1, 'ABC123', 'Renault', 'Logan', 2018, 80000) RETURNING id`,
          [clienteId],
        );
        await db.query(
          `INSERT INTO vehiculos (usuario_id, placa, marca, modelo, anio, kilometraje)
           VALUES ($1, 'XYZ987', 'Mazda', '2', 2020, 30000)`,
          [clienteId],
        );
        const turno = (
          desdeHoras: number,
          estado: string,
          vehiculo: string | null,
        ) =>
          db.query(
            `INSERT INTO turnos (taller_id, bahia_id, servicio_id, usuario_id, vehiculo_id,
                                 rango_tiempo, estado, precio_base_centavos,
                                 iva_centavos, total_centavos)
             VALUES ($1, $2, $3, $4, $5,
                     tstzrange(now() + make_interval(hours => $6),
                               now() + make_interval(hours => $6 + 1), '[)'),
                     $7::estado_turno, 5000000, 0, 5000000)
             RETURNING id`,
            [taller, bahia, servicio, clienteId, vehiculo, desdeHoras, estado],
          );
        await turno(-48, 'atendido', vehiculoConTurno);
        [{ id: turnoFuturo }] = await turno(72, 'programado', null);
      });

      it('pide la contrasena', async () => {
        await http()
          .post('/mis-datos/suprimir')
          .set('Authorization', `Bearer ${tokenCliente}`)
          .send({ password: 'otra-cosa' })
          .expect(403);
      });

      it('no procede con turnos por delante', async () => {
        const { body } = await http()
          .post('/mis-datos/suprimir')
          .set('Authorization', `Bearer ${tokenCliente}`)
          .send({ password: PASSWORD })
          .expect(409);
        expect(body.message).toMatch(/turno/);
      });

      it('anonimiza la cuenta y conserva lo que la ley exige guardar', async () => {
        await db.query("UPDATE turnos SET estado = 'cancelado' WHERE id = $1", [
          turnoFuturo,
        ]);
        const { body } = await http()
          .post('/mis-datos/suprimir')
          .set('Authorization', `Bearer ${tokenCliente}`)
          .send({ password: PASSWORD })
          .expect(200);
        expect(body.conservado.length).toBeGreaterThan(0);

        const [usuario] = await db.query(
          `SELECT nombre, email, telefono, ciudad, activo, suprimido_en
             FROM usuarios WHERE id = $1`,
          [clienteId],
        );
        expect(usuario).toMatchObject({
          nombre: 'Titular suprimido',
          email: `suprimido-${clienteId}@suprimido.invalid`,
          telefono: null,
          ciudad: null,
          activo: false,
        });
        expect(usuario.suprimido_en).toBeInstanceOf(Date);

        // El vehiculo de la orden de trabajo queda (inactivo); el otro no.
        const vehiculos = await db.query(
          'SELECT placa, activo FROM vehiculos WHERE usuario_id = $1',
          [clienteId],
        );
        expect(vehiculos).toEqual([{ placa: 'ABC123', activo: false }]);
        // Los turnos (soporte contable) y las aceptaciones (prueba) quedan.
        const [{ turnos }] = await db.query(
          'SELECT count(*)::int AS turnos FROM turnos WHERE usuario_id = $1',
          [clienteId],
        );
        expect(turnos).toBe(2);
        const [{ aceptaciones }] = await db.query(
          'SELECT count(*)::int AS aceptaciones FROM aceptaciones_legales WHERE usuario_id = $1',
          [clienteId],
        );
        expect(aceptaciones).toBeGreaterThan(0);
        const relaciones = await db.query(
          'SELECT 1 FROM clientes_taller WHERE usuario_id = $1',
          [clienteId],
        );
        expect(relaciones).toEqual([]);
        const [supresion] = await db.query(
          `SELECT detalle FROM solicitudes_titular
            WHERE usuario_id = $1 AND tipo = 'supresion'`,
          [clienteId],
        );
        expect(supresion.detalle.conservado).toEqual(body.conservado);
      });

      it('despues de suprimir no se puede entrar ni pedir enlaces', async () => {
        await http()
          .post('/auth/login')
          .send({
            email: `cliente-legal-${sufijo}@turnos.dev`,
            password: PASSWORD,
          })
          .expect(401);
      });
    });
  });
});
