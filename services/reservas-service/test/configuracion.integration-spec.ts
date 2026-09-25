import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as jwt from 'jsonwebtoken';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

/**
 * Configuracion del taller (Sprint 21): datos fiscales y credenciales,
 * precio con IVA y su foto en el turno, horario y festivos, catalogo de
 * bahias y reasignacion de turnos sin tecnico.
 *
 * Las credenciales no se validan contra Alegra/Wompi aca
 * (VALIDACION_PROVEEDORES=omitir): eso lo cubre el spec unitario del
 * validador con fetch simulado.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describirSiHayDb = DATABASE_URL ? describe : describe.skip;
const SECRETO = process.env.JWT_SECRET ?? 'dev-secret-change-me';

/** Fecha de Bogota del proximo `diaIso` (1 = lunes) a partir de 8 dias. */
function proximo(diaIso: number): string {
  const d = new Date(Date.now() - 5 * 3_600_000);
  d.setUTCDate(d.getUTCDate() + 8);
  while (((d.getUTCDay() + 6) % 7) + 1 !== diaIso)
    d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const a = (fecha: string, hora: string) => `${fecha}T${hora}:00-05:00`;

describirSiHayDb('Configuracion del taller (integration, Sprint 21)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const sufijo = `${Date.now()}`;
  let taller: string;
  let otroTaller: string;
  let bahiaId: string;
  let servicioId: string;
  let tecnicoId: string;
  let otroTecnicoId: string;
  let clienteId: string;
  let tokenAdmin: string;
  let tokenAdminOtro: string;
  let tokenCliente: string;

  const http = () => request(app.getHttpServer());
  const comoAdmin = (r: request.Test) =>
    r.set('Authorization', `Bearer ${tokenAdmin}`);
  const comoCliente = (r: request.Test) =>
    r.set('Authorization', `Bearer ${tokenCliente}`).set('X-Taller', taller);

  beforeAll(async () => {
    process.env.VALIDACION_PROVEEDORES = 'omitir';
    // El CI la define; corriendo local sin .env, una de prueba.
    process.env.ENCRYPTION_KEY ??= 'a'.repeat(64);
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    ds = moduleRef.get(DataSource);

    [{ id: taller }] = await ds.query(
      `INSERT INTO talleres (nombre, slug) VALUES ($1, $2) RETURNING id`,
      [`Taller S21 ${sufijo}`, `s21-${sufijo}`],
    );
    [{ id: otroTaller }] = await ds.query(
      `INSERT INTO talleres (nombre, slug) VALUES ($1, $2) RETURNING id`,
      [`Otro S21 ${sufijo}`, `s21-otro-${sufijo}`],
    );
    [{ id: bahiaId }] = await ds.query(
      `INSERT INTO bahias (nombre, taller_id) VALUES ('Bahia S21', $1) RETURNING id`,
      [taller],
    );
    [{ id: servicioId }] = await ds.query(
      `INSERT INTO servicios (nombre, categoria, duracion_minutos, precio_base_centavos, taller_id)
       VALUES ('Servicio S21', 'mecanica', 30, 1000000, $1) RETURNING id`,
      [taller],
    );
    [{ id: tecnicoId }] = await ds.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol, taller_id)
       VALUES ($1, 'hash', 'Tecnico S21', 'tecnico', $2) RETURNING id`,
      [`tec-s21-${sufijo}@turnos.dev`, taller],
    );
    [{ id: otroTecnicoId }] = await ds.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol, taller_id)
       VALUES ($1, 'hash', 'Otro tecnico S21', 'tecnico', $2) RETURNING id`,
      [`tec2-s21-${sufijo}@turnos.dev`, taller],
    );
    const [{ id: adminId }] = await ds.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol, taller_id)
       VALUES ($1, 'hash', 'Admin S21', 'admin', $2) RETURNING id`,
      [`adm-s21-${sufijo}@turnos.dev`, taller],
    );
    const [{ id: adminOtroId }] = await ds.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol, taller_id)
       VALUES ($1, 'hash', 'Admin otro S21', 'admin', $2) RETURNING id`,
      [`adm2-s21-${sufijo}@turnos.dev`, otroTaller],
    );
    [{ id: clienteId }] = await ds.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol)
       VALUES ($1, 'hash', 'Cliente S21', 'cliente') RETURNING id`,
      [`cli-s21-${sufijo}@turnos.dev`],
    );
    tokenAdmin = jwt.sign(
      { sub: adminId, email: 'a', rol: 'admin', taller },
      SECRETO,
    );
    tokenAdminOtro = jwt.sign(
      { sub: adminOtroId, email: 'b', rol: 'admin', taller: otroTaller },
      SECRETO,
    );
    tokenCliente = jwt.sign(
      { sub: clienteId, email: 'c', rol: 'cliente' },
      SECRETO,
    );
  });

  afterAll(async () => {
    if (ds) {
      const talleres = [taller, otroTaller].filter(Boolean);
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
      await ds.query('DELETE FROM clientes_taller WHERE taller_id = ANY($1)', [
        talleres,
      ]);
      await ds.query(
        'DELETE FROM usuarios WHERE taller_id = ANY($1) OR id = $2',
        [talleres, clienteId],
      );
      // configuracion_fiscal, credenciales, horario y feriados: en cascada.
      await ds.query('DELETE FROM talleres WHERE id = ANY($1)', [talleres]);
    }
    await app?.close();
  });

  describe('datos fiscales y credenciales', () => {
    it('un taller nuevo nace sin datos fiscales y "No responsable" (precios como antes)', async () => {
      const r = await comoAdmin(http().get('/configuracion/fiscal')).expect(
        200,
      );
      expect(r.body).toMatchObject({
        razonSocial: null,
        responsableIva: false,
        completa: false,
        facturacion: null,
        wompi: null,
      });
    });

    it('el cliente no ve la configuracion fiscal', async () => {
      await comoCliente(http().get('/configuracion/fiscal')).expect(403);
    });

    it('rechaza un digito de verificacion que no corresponde al NIT', async () => {
      const r = await comoAdmin(http().put('/configuracion/fiscal'))
        .send({
          razonSocial: 'Taller S21 SAS',
          nit: '800.197.268',
          dv: 5,
          direccion: 'Calle 1 # 2-3',
          municipio: 'Medellin',
          departamento: 'Antioquia',
          responsableIva: true,
        })
        .expect(400);
      expect(r.body.message).toContain('deberia ser 4');
    });

    it('guarda los datos fiscales con el NIT normalizado', async () => {
      const r = await comoAdmin(http().put('/configuracion/fiscal'))
        .send({
          razonSocial: 'Taller S21 SAS',
          nit: '800.197.268',
          dv: 4,
          direccion: 'Calle 1 # 2-3',
          municipio: 'Medellin',
          departamento: 'Antioquia',
          responsableIva: true,
        })
        .expect(200);
      expect(r.body).toMatchObject({
        nit: '800197268',
        dv: 4,
        completa: true,
        responsableIva: true,
      });
    });

    it('el token de Alegra se guarda cifrado y vuelve solo con los ultimos 4', async () => {
      const r = await comoAdmin(http().put('/configuracion/facturacion'))
        .send({
          proveedor: 'alegra',
          usuario: 'taller@s21.co',
          token: 'token-secreto-1234',
        })
        .expect(200);
      expect(r.body.facturacion).toEqual({
        proveedor: 'alegra',
        usuario: 'taller@s21.co',
        token: '••••1234',
      });
      expect(r.body.validado).toBe(false);
      const [fila] = await ds.query(
        'SELECT facturacion_token_cifrado AS t FROM credenciales_taller WHERE taller_id = $1',
        [taller],
      );
      expect(fila.t).not.toContain('token-secreto');
    });

    it('Siigo todavia no esta disponible', async () => {
      await comoAdmin(http().put('/configuracion/facturacion'))
        .send({ proveedor: 'siigo', usuario: 'x@y.co', token: 'token-largo' })
        .expect(400);
    });

    it('Wompi: rechaza llaves de otro ambiente y guarda las correctas enmascaradas', async () => {
      const llaves = {
        ambiente: 'pruebas',
        llavePublica: 'pub_test_s21abcdef',
        llavePrivada: 'prv_test_s21abc9876',
        secretoIntegridad: 'test_integrity_s21aaaa',
        secretoEventos: 'test_events_s21bbbb',
      };
      await comoAdmin(http().put('/configuracion/wompi'))
        .send({ ...llaves, ambiente: 'produccion' })
        .expect(400);
      const r = await comoAdmin(http().put('/configuracion/wompi'))
        .send(llaves)
        .expect(200);
      expect(r.body.wompi).toEqual({
        ambiente: 'pruebas',
        llavePublica: 'pub_test_s21abcdef',
        llavePrivada: '••••9876',
        secretoIntegridad: '••••aaaa',
        secretoEventos: '••••bbbb',
      });
    });

    it('Wompi: cambiar la llave publica conserva los secretos; cambiar de ambiente los exige', async () => {
      const r = await comoAdmin(http().put('/configuracion/wompi'))
        .send({ ambiente: 'pruebas', llavePublica: 'pub_test_s21otra' })
        .expect(200);
      expect(r.body.wompi.llavePrivada).toBe('••••9876');
      await comoAdmin(http().put('/configuracion/wompi'))
        .send({ ambiente: 'produccion', llavePublica: 'pub_prod_s21' })
        .expect(400);
    });

    it('RLS: con rol de cliente la base no devuelve credenciales, aunque este en el taller', async () => {
      const filas = await ds.transaction(async (m) => {
        await m.query('SET LOCAL ROLE turnos_app');
        await m.query(
          `SELECT set_config('app.taller_id', $1, true), set_config('app.usuario_id', $2, true),
                  set_config('app.rol', 'cliente', true)`,
          [taller, clienteId],
        );
        return {
          credenciales: await m.query('SELECT * FROM credenciales_taller'),
          fiscal: await m.query(
            'SELECT responsable_iva FROM configuracion_fiscal',
          ),
        };
      });
      expect(filas.credenciales).toHaveLength(0);
      // Lo publico si: el cliente necesita saber si el precio lleva IVA.
      expect(filas.fiscal).toEqual([{ responsable_iva: true }]);
    });

    it('otro taller no ve ni toca esta configuracion', async () => {
      const r = await http()
        .get('/configuracion/fiscal')
        .set('Authorization', `Bearer ${tokenAdminOtro}`)
        .expect(200);
      expect(r.body.razonSocial).toBeNull();
    });
  });

  describe('precio con IVA y foto en el turno', () => {
    let turnoId: string;

    it('el cliente ve el precio final con IVA y el desglose', async () => {
      const r = await comoCliente(http().get('/servicios')).expect(200);
      const s = r.body.find((x: { id: string }) => x.id === servicioId);
      expect(s.precio).toEqual({
        baseCentavos: 1_000_000,
        ivaCentavos: 190_000,
        totalCentavos: 1_190_000,
        tarifaIva: 19,
      });
      expect(s.anticipo).toBeNull();
    });

    it('anticipo: fuera del 15-20% es 400; dentro, se calcula sobre el total', async () => {
      await comoAdmin(http().patch(`/servicios/${servicioId}`))
        .send({ requiereAnticipo: true, porcentajeAnticipo: 30 })
        .expect(400);
      const r = await comoAdmin(http().patch(`/servicios/${servicioId}`))
        .send({ requiereAnticipo: true, porcentajeAnticipo: 20 })
        .expect(200);
      expect(r.body.anticipo).toEqual({ porcentaje: 20, centavos: 238_000 });
    });

    it('la reserva guarda la foto del precio', async () => {
      const r = await comoCliente(http().post('/appointments'))
        .send({
          bahiaId,
          servicioId,
          tecnicoId,
          inicio: a(proximo(3), '09:00'),
        })
        .expect(201);
      turnoId = r.body.id;
      const [t] = await ds.query(
        `SELECT precio_base_centavos::int AS base, iva_centavos::int AS iva,
                total_centavos::int AS total, tarifa_iva AS tarifa, anticipo_centavos::int AS anticipo
           FROM turnos WHERE id = $1`,
        [turnoId],
      );
      expect(t).toEqual({
        base: 1_000_000,
        iva: 190_000,
        total: 1_190_000,
        tarifa: 19,
        anticipo: 238_000,
      });
    });

    it('cambiar el precio o la configuracion fiscal no toca el turno ya tomado', async () => {
      await comoAdmin(http().patch(`/servicios/${servicioId}`))
        .send({ precioBaseCentavos: 5_000_000 })
        .expect(200);
      const fiscal = await comoAdmin(
        http().get('/configuracion/fiscal'),
      ).expect(200);
      await comoAdmin(http().put('/configuracion/fiscal'))
        .send({ ...fiscal.body, nit: fiscal.body.nit, responsableIva: false })
        .expect(200);

      const mios = await http()
        .get('/appointments/mios')
        .set('Authorization', `Bearer ${tokenCliente}`)
        .expect(200);
      expect(
        mios.body.find((t: { id: string }) => t.id === turnoId).precio,
      ).toEqual({
        baseCentavos: 1_000_000,
        ivaCentavos: 190_000,
        totalCentavos: 1_190_000,
        tarifaIva: 19,
      });

      // Y el servicio ahora sale sin IVA (No responsable).
      const s = await comoCliente(
        http().get(`/servicios/${servicioId}`),
      ).expect(200);
      expect(s.body.precio).toMatchObject({
        totalCentavos: 5_000_000,
        tarifaIva: null,
      });
    });
  });

  describe('horario y festivos', () => {
    it('lunes a viernes 08:00-12:00: sabado cerrado y tarde fuera de horario', async () => {
      const dias = [1, 2, 3, 4, 5].map((dia) => ({
        dia,
        apertura: '08:00',
        cierre: '12:00',
      }));
      const r = await comoAdmin(http().put('/configuracion/horario'))
        .send({ dias })
        .expect(200);
      // El turno del miercoles a las 09:00 sigue dentro del horario.
      expect(r.body.turnosFueraDeHorario).toBe(0);

      const sabado = await comoCliente(http().post('/appointments'))
        .send({
          bahiaId,
          servicioId,
          tecnicoId,
          inicio: a(proximo(6), '09:00'),
        })
        .expect(400);
      expect(sabado.body.message).toContain('no atiende');

      const tarde = await comoCliente(http().post('/appointments'))
        .send({
          bahiaId,
          servicioId,
          tecnicoId,
          inicio: a(proximo(2), '11:45'),
        })
        .expect(400);
      expect(tarde.body.message).toContain('08:00-12:00');
    });

    it('rechaza horarios que no van en cuartos de hora o al reves', async () => {
      await comoAdmin(http().put('/configuracion/horario'))
        .send({ dias: [{ dia: 1, apertura: '08:10', cierre: '12:00' }] })
        .expect(400);
      await comoAdmin(http().put('/configuracion/horario'))
        .send({ dias: [{ dia: 1, apertura: '12:00', cierre: '08:00' }] })
        .expect(400);
    });

    it('la grilla de un dia cerrado viene vacia con el motivo', async () => {
      const r = await comoCliente(
        http()
          .get('/appointments/disponibilidad')
          .query({ fecha: proximo(7), bahiaId, servicioId, tecnicoId }),
      ).expect(200);
      expect(r.body).toMatchObject({
        jornada: null,
        cerrado: 'Cerrado',
        horarios: [],
      });
    });

    it('un festivo cierra el dia y avisa los turnos que ya estaban tomados', async () => {
      const r = await comoAdmin(http().post('/configuracion/feriados'))
        .send({ fecha: proximo(3), motivo: 'Inventario' })
        .expect(201);
      // El turno del miercoles a las 09:00 queda en un dia cerrado.
      expect(r.body.turnosFueraDeHorario).toBe(1);

      const grilla = await comoCliente(
        http()
          .get('/appointments/disponibilidad')
          .query({ fecha: proximo(3), bahiaId, servicioId, tecnicoId }),
      ).expect(200);
      expect(grilla.body.cerrado).toBe('Inventario');

      const reserva = await comoCliente(http().post('/appointments'))
        .send({
          bahiaId,
          servicioId,
          tecnicoId,
          inicio: a(proximo(3), '10:00'),
        })
        .expect(400);
      expect(reserva.body.message).toContain('Inventario');

      await comoAdmin(
        http().delete(`/configuracion/feriados/${proximo(3)}`),
      ).expect(204);
    });

    it('carga los festivos de Colombia una sola vez', async () => {
      const primera = await comoAdmin(
        http().post('/configuracion/feriados/colombia'),
      )
        .send({ anio: 2030 })
        .expect(201);
      // 18 festivos en 17 fechas: en 2030 San Pedro y San Pablo (sabado 29/6,
      // pasa al lunes) y Sagrado Corazon caen los dos el lunes 1 de julio.
      expect(primera.body.agregados).toBe(17);
      const segunda = await comoAdmin(
        http().post('/configuracion/feriados/colombia'),
      )
        .send({ anio: 2030 })
        .expect(201);
      expect(segunda.body.agregados).toBe(0);
    });

    it('el panel mide cada dia contra su jornada; el cerrado viene sin capacidad', async () => {
      // Viernes y el sabado SIGUIENTE (proximo(6) puede caer antes que
      // proximo(5) segun el dia en que corra el test).
      const viernes = proximo(5);
      const sabado = new Date(`${viernes}T12:00:00Z`);
      sabado.setUTCDate(sabado.getUTCDate() + 1);
      const sabadoISO = sabado.toISOString().slice(0, 10);
      const r = await comoAdmin(
        http().get('/bahias/carga').query({ desde: viernes, hasta: sabadoISO }),
      ).expect(200);
      expect(r.body.resumen).toEqual([
        expect.objectContaining({
          fecha: viernes,
          jornada: { apertura: '08:00', cierre: '12:00', minutos: 240 },
          cerrado: null,
        }),
        expect.objectContaining({
          fecha: sabadoISO,
          jornada: null,
          cerrado: 'Cerrado',
        }),
      ]);
    });

    it('el cliente puede leer el horario; no cambiarlo', async () => {
      const r = await comoCliente(http().get('/configuracion/horario')).expect(
        200,
      );
      expect(r.body.dias).toHaveLength(5);
      await comoCliente(http().put('/configuracion/horario'))
        .send({ dias: [] })
        .expect(403);
    });
  });

  describe('catalogo de bahias', () => {
    let nueva: string;

    it('alta, baja de servicio y listado del admin con las inactivas', async () => {
      const r = await comoAdmin(http().post('/bahias'))
        .send({ nombre: 'Bahia nueva S21' })
        .expect(201);
      nueva = r.body.id;
      expect(r.body).toMatchObject({ nombre: 'Bahia nueva S21', activa: true });

      const baja = await comoAdmin(http().patch(`/bahias/${nueva}`))
        .send({ activa: false })
        .expect(200);
      expect(baja.body).toMatchObject({ activa: false, turnosPorVenir: 0 });

      const reservables = await comoCliente(http().get('/bahias')).expect(200);
      expect(reservables.body.map((b: { id: string }) => b.id)).not.toContain(
        nueva,
      );
      const todas = await comoAdmin(http().get('/bahias/todas')).expect(200);
      expect(
        todas.body.find((b: { id: string }) => b.id === nueva).activa,
      ).toBe(false);
    });

    it('el admin de otro taller no la encuentra', async () => {
      await http()
        .patch(`/bahias/${nueva}`)
        .set('Authorization', `Bearer ${tokenAdminOtro}`)
        .send({ nombre: 'Robada' })
        .expect(404);
    });

    it('un servicio con turnos no se borra: 409', async () => {
      const r = await comoAdmin(
        http().delete(`/servicios/${servicioId}`),
      ).expect(409);
      expect(r.body.message).toContain('Desactivalo');
    });
  });

  describe('turnos sin tecnico', () => {
    it('lista los que vienen sin tecnico y los reasigna a uno activo', async () => {
      const [{ id }] = await ds.query(
        `INSERT INTO turnos (taller_id, bahia_id, servicio_id, usuario_id, tecnico_id, rango_tiempo)
         VALUES ($1, $2, $3, $4, NULL, tstzrange($5::timestamptz, $6::timestamptz, '[)'))
         RETURNING id`,
        [
          taller,
          bahiaId,
          servicioId,
          clienteId,
          a(proximo(4), '10:00'),
          a(proximo(4), '10:30'),
        ],
      );
      const lista = await comoAdmin(
        http().get('/appointments/sin-tecnico'),
      ).expect(200);
      expect(lista.body.map((t: { id: string }) => t.id)).toEqual([id]);

      // Un tecnico dado de baja no se puede asignar.
      await ds.query('UPDATE usuarios SET activo = false WHERE id = $1', [
        otroTecnicoId,
      ]);
      await comoAdmin(http().patch(`/appointments/${id}/tecnico`))
        .send({ tecnicoId: otroTecnicoId })
        .expect(404);

      await comoAdmin(http().patch(`/appointments/${id}/tecnico`))
        .send({ tecnicoId })
        .expect(200);
      const despues = await comoAdmin(
        http().get('/appointments/sin-tecnico'),
      ).expect(200);
      expect(despues.body).toEqual([]);
    });

    it('el tecnico dado de baja no aparece para reservar', async () => {
      const r = await comoCliente(http().get('/technicians')).expect(200);
      const ids = r.body.map((t: { id: string }) => t.id);
      expect(ids).toContain(tecnicoId);
      expect(ids).not.toContain(otroTecnicoId);
    });
  });
});
