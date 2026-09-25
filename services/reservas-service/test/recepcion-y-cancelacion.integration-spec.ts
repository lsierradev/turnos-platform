import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as jwt from 'jsonwebtoken';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

/**
 * Recepcion del vehiculo, ciclo del turno y politica de cancelacion
 * (Sprint 22), contra Postgres real: RLS, el trigger de inmutabilidad y el
 * consecutivo de la orden viven en la base.
 *
 * Los bordes de la ventana (3 h 59 min vs 4 h 01 min) usan turnos
 * insertados directo con el reloj real: un margen de un minuto a cada lado
 * sobra para lo que tarda un request.
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

// PNG de 1x1: firma valida y unos pocos bytes.
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describirSiHayDb(
  'Recepcion y politica de cancelacion (integration, Sprint 22)',
  () => {
    let app: INestApplication;
    let ds: DataSource;
    const sufijo = `${Date.now()}`;
    let taller: string;
    let otroTaller: string;
    let bahiaId: string;
    let otraBahiaId: string;
    let servicioId: string;
    let tecnicoId: string;
    let otroTecnicoId: string;
    let adminId: string;
    let clienteId: string;
    let otroClienteId: string;
    let tokenAdmin: string;
    let tokenAdminOtro: string;
    let tokenTecnico: string;
    let tokenOtroTecnico: string;
    let tokenCliente: string;
    let tokenOtroCliente: string;

    const http = () => request(app.getHttpServer());
    const comoAdmin = (r: request.Test) =>
      r.set('Authorization', `Bearer ${tokenAdmin}`);
    const comoTecnico = (r: request.Test) =>
      r.set('Authorization', `Bearer ${tokenTecnico}`);
    const comoCliente = (r: request.Test, enTaller = taller) =>
      r
        .set('Authorization', `Bearer ${tokenCliente}`)
        .set('X-Taller', enTaller);
    const comoOtroCliente = (r: request.Test) =>
      r
        .set('Authorization', `Bearer ${tokenOtroCliente}`)
        .set('X-Taller', taller);

    /**
     * Turno insertado directo (modo sistema), para ubicarlo a minutos de
     * ahora sin pasar por el horario del taller. Dura un minuto: dos turnos
     * del mismo cliente a 239 y 241 minutos no se solapan.
     */
    async function turnoEn(
      minutos: number,
      opciones: {
        usuario?: string;
        tallerId?: string;
        bahia?: string;
        servicio?: string;
        tecnico?: string | null;
      } = {},
    ): Promise<string> {
      const [{ id }] = await ds.query(
        `INSERT INTO turnos (taller_id, bahia_id, servicio_id, tecnico_id, usuario_id,
                           rango_tiempo, precio_base_centavos, iva_centavos, total_centavos)
       VALUES ($1, $2, $3, $4, $5,
               tstzrange(now() + make_interval(mins => $6),
                         now() + make_interval(mins => $6 + 1), '[)'),
               1000000, 0, 1000000)
       RETURNING id`,
        [
          opciones.tallerId ?? taller,
          opciones.bahia ?? bahiaId,
          opciones.servicio ?? servicioId,
          opciones.tecnico === undefined ? tecnicoId : opciones.tecnico,
          opciones.usuario ?? clienteId,
          minutos,
        ],
      );
      return id;
    }

    async function strikesDe(usuario: string, enTaller = taller) {
      return ds.query(
        `SELECT motivo, detalle, anulado_en, turno_id FROM strikes
        WHERE usuario_id = $1 AND taller_id = $2 ORDER BY creado_en`,
        [usuario, enTaller],
      );
    }

    beforeAll(async () => {
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
        [`Taller S22 ${sufijo}`, `s22-${sufijo}`],
      );
      [{ id: otroTaller }] = await ds.query(
        `INSERT INTO talleres (nombre, slug) VALUES ($1, $2) RETURNING id`,
        [`Otro S22 ${sufijo}`, `s22-otro-${sufijo}`],
      );
      [{ id: bahiaId }] = await ds.query(
        `INSERT INTO bahias (nombre, taller_id) VALUES ('Bahia S22', $1) RETURNING id`,
        [taller],
      );
      [{ id: otraBahiaId }] = await ds.query(
        `INSERT INTO bahias (nombre, taller_id) VALUES ('Bahia otro S22', $1) RETURNING id`,
        [otroTaller],
      );
      [{ id: servicioId }] = await ds.query(
        `INSERT INTO servicios (nombre, categoria, duracion_minutos, precio_base_centavos,
                              garantia_dias, taller_id)
       VALUES ('Frenos S22', 'mecanica', 60, 1000000, 90, $1) RETURNING id`,
        [taller],
      );
      [{ id: tecnicoId }] = await ds.query(
        `INSERT INTO usuarios (email, password_hash, nombre, rol, taller_id)
       VALUES ($1, 'hash', 'Tecnico S22', 'tecnico', $2) RETURNING id`,
        [`tec-s22-${sufijo}@turnos.dev`, taller],
      );
      [{ id: otroTecnicoId }] = await ds.query(
        `INSERT INTO usuarios (email, password_hash, nombre, rol, taller_id)
       VALUES ($1, 'hash', 'Otro tecnico S22', 'tecnico', $2) RETURNING id`,
        [`tec2-s22-${sufijo}@turnos.dev`, taller],
      );
      [{ id: adminId }] = await ds.query(
        `INSERT INTO usuarios (email, password_hash, nombre, rol, taller_id)
       VALUES ($1, 'hash', 'Admin S22', 'admin', $2) RETURNING id`,
        [`adm-s22-${sufijo}@turnos.dev`, taller],
      );
      const [{ id: adminOtroId }] = await ds.query(
        `INSERT INTO usuarios (email, password_hash, nombre, rol, taller_id)
       VALUES ($1, 'hash', 'Admin otro S22', 'admin', $2) RETURNING id`,
        [`adm2-s22-${sufijo}@turnos.dev`, otroTaller],
      );
      [{ id: clienteId }] = await ds.query(
        `INSERT INTO usuarios (email, password_hash, nombre, rol)
       VALUES ($1, 'hash', 'Cliente S22', 'cliente') RETURNING id`,
        [`cli-s22-${sufijo}@turnos.dev`],
      );
      [{ id: otroClienteId }] = await ds.query(
        `INSERT INTO usuarios (email, password_hash, nombre, rol)
       VALUES ($1, 'hash', 'Otro cliente S22', 'cliente') RETURNING id`,
        [`cli2-s22-${sufijo}@turnos.dev`],
      );
      await ds.query(
        `INSERT INTO clientes_taller (taller_id, usuario_id)
       VALUES ($1, $2), ($1, $3), ($4, $2)`,
        [taller, clienteId, otroClienteId, otroTaller],
      );
      const firmar = (p: object) => jwt.sign(p, SECRETO);
      tokenAdmin = firmar({ sub: adminId, email: 'a', rol: 'admin', taller });
      tokenAdminOtro = firmar({
        sub: adminOtroId,
        email: 'b',
        rol: 'admin',
        taller: otroTaller,
      });
      tokenTecnico = firmar({
        sub: tecnicoId,
        email: 't',
        rol: 'tecnico',
        taller,
      });
      tokenOtroTecnico = firmar({
        sub: otroTecnicoId,
        email: 't2',
        rol: 'tecnico',
        taller,
      });
      tokenCliente = firmar({ sub: clienteId, email: 'c', rol: 'cliente' });
      tokenOtroCliente = firmar({
        sub: otroClienteId,
        email: 'd',
        rol: 'cliente',
      });
    });

    afterAll(async () => {
      if (ds) {
        const talleres = [taller, otroTaller].filter(Boolean);
        const usuarios = [clienteId, otroClienteId].filter(Boolean);
        // reclamos_strike y recepcion_fotos caen en cascada.
        await ds.query('DELETE FROM strikes WHERE taller_id = ANY($1)', [
          talleres,
        ]);
        await ds.query('DELETE FROM notificaciones WHERE taller_id = ANY($1)', [
          talleres,
        ]);
        await ds.query('DELETE FROM recepciones WHERE taller_id = ANY($1)', [
          talleres,
        ]);
        await ds.query('DELETE FROM turnos WHERE taller_id = ANY($1)', [
          talleres,
        ]);
        await ds.query('DELETE FROM vehiculos WHERE usuario_id = ANY($1)', [
          usuarios,
        ]);
        await ds.query('DELETE FROM servicios WHERE taller_id = ANY($1)', [
          talleres,
        ]);
        await ds.query('DELETE FROM bahias WHERE taller_id = ANY($1)', [
          talleres,
        ]);
        await ds.query(
          'DELETE FROM clientes_taller WHERE taller_id = ANY($1)',
          [talleres],
        );
        await ds.query(
          'DELETE FROM usuarios WHERE taller_id = ANY($1) OR id = ANY($2)',
          [talleres, usuarios],
        );
        await ds.query('DELETE FROM talleres WHERE id = ANY($1)', [talleres]);
      }
      await app?.close();
    });

    // ------------------------------------------------------------ vehiculos
    let vehiculoId: string;

    describe('vehiculos del cliente', () => {
      it('el cliente registra su vehiculo con la placa normalizada', async () => {
        const r = await comoCliente(http().post('/vehiculos'))
          .send({
            placa: 'abc-12d',
            marca: 'Renault',
            modelo: 'Logan',
            anio: 2019,
            kilometraje: 45000,
          })
          .expect(201);
        expect(r.body).toMatchObject({ placa: 'ABC12D', usuarioId: clienteId });
        vehiculoId = r.body.id;
      });

      it('la misma placa dos veces para el mismo cliente: 409', async () => {
        await comoCliente(http().post('/vehiculos'))
          .send({
            placa: 'ABC 12D',
            marca: 'Renault',
            modelo: 'Logan',
            anio: 2019,
            kilometraje: 1,
          })
          .expect(409);
      });

      it('un ano imposible es 400', async () => {
        await comoCliente(http().post('/vehiculos'))
          .send({
            placa: 'XYZ999',
            marca: 'Mazda',
            modelo: '3',
            anio: new Date().getUTCFullYear() + 5,
            kilometraje: 0,
          })
          .expect(400);
      });

      it('otro cliente no lo ve ni lo edita', async () => {
        const r = await comoOtroCliente(http().get('/vehiculos')).expect(200);
        expect(r.body).toEqual([]);
        await comoOtroCliente(http().patch(`/vehiculos/${vehiculoId}`))
          .send({ kilometraje: 1 })
          .expect(404);
      });

      it('el admin ve los de sus clientes; el de otro taller no', async () => {
        const r = await comoAdmin(
          http().get(`/vehiculos?clienteId=${clienteId}`),
        ).expect(200);
        expect(r.body.map((v: { id: string }) => v.id)).toContain(vehiculoId);
        await http()
          .get(`/vehiculos?clienteId=${otroClienteId}`)
          .set('Authorization', `Bearer ${tokenAdminOtro}`)
          .expect(404);
      });

      it('un cliente no pide los vehiculos de otro: 403', async () => {
        await comoCliente(
          http().get(`/vehiculos?clienteId=${otroClienteId}`),
        ).expect(403);
      });

      it('un cliente no reserva con el vehiculo de otro (ni sabe si existe: 404)', async () => {
        const lunes = proximo(1);
        await comoOtroCliente(http().post('/appointments'))
          .send({
            bahiaId,
            servicioId,
            tecnicoId,
            inicio: a(lunes, '08:00'),
            vehiculoId,
          })
          .expect(404);
      });

      it('el admin no le cuelga a un cliente el vehiculo de otro: 400', async () => {
        const lunes = proximo(1);
        await comoAdmin(http().post('/appointments'))
          .send({
            bahiaId,
            servicioId,
            tecnicoId,
            inicio: a(lunes, '08:00'),
            clienteId: otroClienteId,
            vehiculoId,
          })
          .expect(400);
      });
    });

    // --------------------------------------------------------------- politica
    describe('politica del taller', () => {
      it('nace con 4 horas y 12 meses', async () => {
        const r = await comoCliente(http().get('/politica')).expect(200);
        expect(r.body).toMatchObject({
          ventanaHoras: 4,
          vigenciaStrikesMeses: 12,
          strikesParaPrepago: 3,
          strikesVigentes: 0,
          requierePrepago: false,
        });
      });

      it('la cambia el admin, no el cliente', async () => {
        await comoCliente(http().put('/politica'))
          .send({ ventanaHoras: 1, vigenciaStrikesMeses: 1 })
          .expect(403);
        await comoAdmin(http().put('/politica'))
          .send({ ventanaHoras: 100, vigenciaStrikesMeses: 12 })
          .expect(400);
      });
    });

    // ---------------------------------------------- ventana: hora del taller
    describe('ventana de cancelacion en los bordes', () => {
      const tzOriginal = process.env.TZ;
      // El proceso en otra zona: la ventana no puede depender de ella.
      beforeAll(() => {
        process.env.TZ = 'Asia/Tokyo';
      });
      afterAll(() => {
        process.env.TZ = tzOriginal;
      });

      it('cancelar a 4 h 01 min del turno es gratis', async () => {
        const turno = await turnoEn(241);
        const r = await comoCliente(
          http().post(`/appointments/${turno}/cancelar`),
        )
          .send({})
          .expect(201);
        expect(r.body.strike).toBe(false);
        expect(r.body.turno).toMatchObject({
          estado: 'cancelado',
          canceladoPor: 'cliente',
        });
        expect(
          (await strikesDe(clienteId)).filter(
            (s: { turno_id: string }) => s.turno_id === turno,
          ),
        ).toHaveLength(0);
      });

      it('cancelar a 3 h 59 min suma un strike, con la hora del taller en el detalle', async () => {
        const turno = await turnoEn(239);
        const [{ inicio }] = await ds.query(
          `SELECT to_char(lower(rango_tiempo) AT TIME ZONE 'America/Bogota', 'HH24:MI') AS inicio
           FROM turnos WHERE id = $1`,
          [turno],
        );
        const r = await comoCliente(
          http().post(`/appointments/${turno}/cancelar`),
        )
          .send({})
          .expect(201);
        expect(r.body.strike).toBe(true);
        const [strike] = (await strikesDe(clienteId)).filter(
          (s: { turno_id: string }) => s.turno_id === turno,
        );
        expect(strike.motivo).toBe('cancelacion_tardia');
        // Hora de Bogota (no la de Tokio del proceso ni UTC).
        expect(strike.detalle).toContain(`a las ${inicio} con 3 h 5`);
        expect(strike.detalle).toContain('hasta 4 h antes');
      });

      it('con la ventana del taller en 6 horas, 4 h 01 min ya es tarde', async () => {
        await comoAdmin(http().put('/politica'))
          .send({ ventanaHoras: 6, vigenciaStrikesMeses: 12 })
          .expect(200);
        try {
          const turno = await turnoEn(241);
          const r = await comoCliente(
            http().post(`/appointments/${turno}/cancelar`),
          )
            .send({})
            .expect(201);
          expect(r.body.strike).toBe(true);
        } finally {
          await comoAdmin(http().put('/politica'))
            .send({ ventanaHoras: 4, vigenciaStrikesMeses: 12 })
            .expect(200);
        }
      });

      it('el cliente sin el taller del turno elegido no lo modifica', async () => {
        const turno = await turnoEn(600);
        await comoCliente(
          http().post(`/appointments/${turno}/cancelar`),
          otroTaller,
        )
          .send({})
          .expect(400);
      });
    });

    // ------------------------------------------ el taller nunca suma strikes
    describe('cancelaciones del taller', () => {
      it('el taller cancela a minutos del turno: sin strike', async () => {
        const antes = (await strikesDe(clienteId)).length;
        const turno = await turnoEn(20);
        const r = await comoAdmin(
          http().post(`/appointments/${turno}/cancelar`),
        )
          .send({ motivo: 'Se daño el elevador' })
          .expect(201);
        expect(r.body).toMatchObject({
          strike: false,
          turno: {
            canceladoPor: 'taller',
            motivoCancelacion: 'Se daño el elevador',
          },
        });
        expect(await strikesDe(clienteId)).toHaveLength(antes);
      });

      it('el taller no atiende un turno ya empezado: lo cancela, sin strike', async () => {
        const antes = (await strikesDe(clienteId)).length;
        const turno = await turnoEn(-30);
        await comoAdmin(http().patch(`/appointments/${turno}/estado`))
          .send({ estado: 'cancelado', motivo: 'Tecnico enfermo' })
          .expect(200);
        expect(await strikesDe(clienteId)).toHaveLength(antes);
      });

      it('el tecnico no cancela', async () => {
        const turno = await turnoEn(-30);
        await comoTecnico(http().post(`/appointments/${turno}/cancelar`))
          .send({})
          .expect(403);
        await comoTecnico(http().patch(`/appointments/${turno}/estado`))
          .send({ estado: 'cancelado' })
          .expect(403);
      });
    });

    // ------------------------------------------------------------ reprogramar
    describe('reprogramar', () => {
      it('tarde: strike, turno nuevo con el mismo precio y el viejo apunta al nuevo', async () => {
        const original = await turnoEn(120);
        const martes = proximo(2);
        const r = await comoCliente(
          http().post(`/appointments/${original}/reprogramar`),
        )
          .send({ inicio: a(martes, '09:00') })
          .expect(201);
        expect(r.body.strike).toBe(true);
        expect(r.body.turno).toMatchObject({
          estado: 'programado',
          totalCentavos: 1000000,
        });
        const [viejo] = await ds.query(
          'SELECT estado, cancelado_por, reprogramado_a FROM turnos WHERE id = $1',
          [original],
        );
        expect(viejo).toEqual({
          estado: 'cancelado',
          cancelado_por: 'cliente',
          reprogramado_a: r.body.turno.id,
        });
        const [strike] = (await strikesDe(clienteId)).filter(
          (s: { turno_id: string }) => s.turno_id === original,
        );
        expect(strike.motivo).toBe('reprogramacion_tardia');
      });

      it('no se reprograma a una bahia de otro taller (404) y el original sigue igual', async () => {
        const original = await turnoEn(600 * 3);
        await comoCliente(http().post(`/appointments/${original}/reprogramar`))
          .send({ inicio: a(proximo(5), '09:00'), bahiaId: otraBahiaId })
          .expect(404);
        const [turno] = await ds.query(
          'SELECT estado FROM turnos WHERE id = $1',
          [original],
        );
        expect(turno.estado).toBe('programado');
      });

      it('si el horario nuevo choca, no cambia nada: ni cancelacion ni strike', async () => {
        const miercoles = proximo(3);
        // Otro cliente ya tiene la bahia a las 10.
        await comoOtroCliente(http().post('/appointments'))
          .send({
            bahiaId,
            servicioId,
            tecnicoId,
            inicio: a(miercoles, '10:00'),
          })
          .expect(201);
        const original = await turnoEn(60, { tecnico: otroTecnicoId });
        const antes = (await strikesDe(clienteId)).length;
        const r = await comoCliente(
          http().post(`/appointments/${original}/reprogramar`),
        )
          .send({ inicio: a(miercoles, '10:00'), tecnicoId: otroTecnicoId })
          .expect(409);
        expect(Array.isArray(r.body.sugerencias)).toBe(true);
        const [turno] = await ds.query(
          'SELECT estado FROM turnos WHERE id = $1',
          [original],
        );
        expect(turno.estado).toBe('programado');
        expect(await strikesDe(clienteId)).toHaveLength(antes);
      });
    });

    // ------------------------------------------------------ 3 strikes: prepago
    describe('tres strikes', () => {
      it('con 3 vigentes reserva pagando el 100%; en otro taller no', async () => {
        // A esta altura tiene 3 (cancelacion tardia x2 y reprogramacion).
        const politica = await comoCliente(http().get('/politica')).expect(200);
        expect(politica.body).toMatchObject({
          strikesVigentes: 3,
          requierePrepago: true,
        });

        const jueves = proximo(4);
        const r = await comoCliente(http().post('/appointments'))
          .send({ bahiaId, servicioId, tecnicoId, inicio: a(jueves, '08:00') })
          .expect(201);
        expect(r.body).toMatchObject({
          anticipoPorStrikes: true,
          anticipoCentavos: r.body.totalCentavos,
        });

        const otro = await comoCliente(
          http().get('/politica'),
          otroTaller,
        ).expect(200);
        expect(otro.body).toMatchObject({
          strikesVigentes: 0,
          requierePrepago: false,
        });
      });

      it('el admin ve el estado del cliente al reservar por el', async () => {
        const r = await comoAdmin(
          http().get(`/politica?clienteId=${clienteId}`),
        ).expect(200);
        expect(r.body.requierePrepago).toBe(true);
      });

      it('un strike vencido no cuenta', async () => {
        const turno = await turnoEn(-60 * 24 * 400, {
          usuario: otroClienteId,
          tecnico: null,
        });
        await ds.query(
          `INSERT INTO strikes (taller_id, usuario_id, turno_id, motivo, detalle, creado_en, vence_en)
         VALUES ($1, $2, $3, 'no_asistio', 'viejo', now() - interval '13 months',
                 now() - interval '1 month')`,
          [taller, otroClienteId, turno],
        );
        const r = await comoOtroCliente(http().get('/politica')).expect(200);
        expect(r.body.strikesVigentes).toBe(0);
      });
    });

    // --------------------------------------------------- perfil y reclamos
    describe('strikes en el perfil, reclamos y anulacion', () => {
      let strikeId: string;

      it('el cliente ve sus strikes con motivo, fecha y taller', async () => {
        const r = await http()
          .get('/strikes/mios')
          .set('Authorization', `Bearer ${tokenCliente}`)
          .expect(200);
        expect(r.body.length).toBeGreaterThanOrEqual(3);
        expect(r.body[0]).toMatchObject({
          estado: 'vigente',
          taller: { id: taller },
          reclamo: null,
        });
        expect(r.body[0].detalle).toBeTruthy();
        strikeId = r.body[0].id;
      });

      it('otro cliente no ve ni reclama los ajenos', async () => {
        const r = await comoOtroCliente(http().get('/strikes/mios')).expect(
          200,
        );
        expect(r.body.map((s: { id: string }) => s.id)).not.toContain(strikeId);
        await comoOtroCliente(http().post(`/strikes/${strikeId}/reclamo`))
          .send({ texto: 'No fui yo, nunca reserve eso' })
          .expect(404);
      });

      it('el cliente reclama una vez', async () => {
        await comoCliente(http().post(`/strikes/${strikeId}/reclamo`))
          .send({ texto: 'corto' })
          .expect(400);
        const r = await comoCliente(http().post(`/strikes/${strikeId}/reclamo`))
          .send({ texto: 'Avise por telefono con tiempo y no lo registraron.' })
          .expect(201);
        expect(r.body.reclamo).toMatchObject({ resultado: null });
        await comoCliente(http().post(`/strikes/${strikeId}/reclamo`))
          .send({ texto: 'Otra vez el mismo reclamo por las dudas.' })
          .expect(409);
      });

      it('el admin ve los reclamos pendientes; el de otro taller no los toca', async () => {
        const r = await comoAdmin(
          http().get('/strikes?estado=reclamos'),
        ).expect(200);
        expect(r.body.map((s: { id: string }) => s.id)).toEqual([strikeId]);
        expect(r.body[0].cliente).toMatchObject({ id: clienteId });
        await http()
          .post(`/strikes/${strikeId}/anular`)
          .set('Authorization', `Bearer ${tokenAdminOtro}`)
          .send({ justificacion: 'Intento desde otro taller' })
          .expect(404);
      });

      it('anular exige justificacion, y el anulado deja de contar', async () => {
        await comoAdmin(http().post(`/strikes/${strikeId}/anular`))
          .send({ justificacion: 'ok' })
          .expect(400);
        const r = await comoAdmin(http().post(`/strikes/${strikeId}/anular`))
          .send({
            justificacion: 'Consta la llamada en el registro del taller.',
          })
          .expect(201);
        expect(r.body).toMatchObject({
          estado: 'anulado',
          anulacion: {
            justificacion: 'Consta la llamada en el registro del taller.',
          },
          // El reclamo pendiente queda aceptado con la misma respuesta.
          reclamo: { resultado: 'aceptado' },
        });
        const p = await comoCliente(http().get('/politica')).expect(200);
        expect(p.body).toMatchObject({
          strikesVigentes: 2,
          requierePrepago: false,
        });
      });

      it('un reclamo rechazado deja el strike vigente con la respuesta', async () => {
        const mios = await http()
          .get('/strikes/mios')
          .set('Authorization', `Bearer ${tokenCliente}`)
          .expect(200);
        const otro = mios.body.find(
          (s: { estado: string }) => s.estado === 'vigente',
        );
        await comoCliente(http().post(`/strikes/${otro.id}/reclamo`))
          .send({ texto: 'Me equivoque de dia, perdon.' })
          .expect(201);
        const r = await comoAdmin(
          http().post(`/strikes/${otro.id}/reclamo/resolver`),
        )
          .send({ aceptar: false, respuesta: 'La cancelacion llego tarde.' })
          .expect(201);
        expect(r.body).toMatchObject({
          estado: 'vigente',
          reclamo: {
            resultado: 'rechazado',
            respuesta: 'La cancelacion llego tarde.',
          },
        });
      });
    });

    // ------------------------------------------------ no-show y su correccion
    describe('cierre: no asistio', () => {
      it('el tecnico marca no asistio: strike; el admin lo corrige: anulado', async () => {
        const turno = await turnoEn(-90, { usuario: otroClienteId });
        await comoTecnico(http().patch(`/appointments/${turno}/estado`))
          .send({ estado: 'no_asistio' })
          .expect(200);
        let [strike] = (await strikesDe(otroClienteId)).filter(
          (s: { turno_id: string }) => s.turno_id === turno,
        );
        expect(strike).toMatchObject({
          motivo: 'no_asistio',
          anulado_en: null,
        });

        // El tecnico no corrige un cierre.
        await comoTecnico(http().patch(`/appointments/${turno}/estado`))
          .send({ estado: 'atendido' })
          .expect(403);
        await comoAdmin(http().patch(`/appointments/${turno}/estado`))
          .send({ estado: 'atendido' })
          .expect(200);
        [strike] = (await strikesDe(otroClienteId)).filter(
          (s: { turno_id: string }) => s.turno_id === turno,
        );
        expect(strike.anulado_en).not.toBeNull();
      });

      it('no asistio antes de la hora: 400', async () => {
        const turno = await turnoEn(30, { usuario: otroClienteId });
        await comoTecnico(http().patch(`/appointments/${turno}/estado`))
          .send({ estado: 'no_asistio' })
          .expect(400);
      });

      it('un tecnico no cierra turnos de otro tecnico', async () => {
        const turno = await turnoEn(-200, { usuario: otroClienteId });
        await http()
          .patch(`/appointments/${turno}/estado`)
          .set('Authorization', `Bearer ${tokenOtroTecnico}`)
          .send({ estado: 'atendido' })
          .expect(404);
      });
    });

    // ------------------------------------------- recepcion y orden de trabajo
    describe('recepcion y orden de trabajo', () => {
      let turno: string;
      let recepcionId: string;

      beforeAll(async () => {
        turno = await turnoEn(-10, { usuario: otroClienteId });
      });

      it('el cliente no carga la recepcion', async () => {
        await comoOtroCliente(http().put(`/appointments/${turno}/recepcion`))
          .send({})
          .expect(403);
      });

      it('con el vehiculo de otro cliente: 400', async () => {
        await comoAdmin(http().put(`/appointments/${turno}/recepcion`))
          .send({
            vehiculoId,
            kilometraje: 10,
            nivelCombustible: 2,
            estadoVehiculo: 'Bien',
          })
          .expect(400);
      });

      it('el personal carga la recepcion: numero de orden 1 y km del vehiculo al dia', async () => {
        const v = await comoAdmin(http().post('/vehiculos'))
          .send({
            clienteId: otroClienteId,
            placa: 'JKL345',
            marca: 'Chevrolet',
            modelo: 'Spark',
            anio: 2015,
            kilometraje: 80000,
          })
          .expect(201);
        const r = await comoTecnico(
          http().put(`/appointments/${turno}/recepcion`),
        )
          .send({
            vehiculoId: v.body.id,
            kilometraje: 81234,
            nivelCombustible: 1,
            estadoVehiculo: 'Rayon en la puerta trasera izquierda.',
            objetosDejados: 'Silla de bebe',
          })
          .expect(200);
        expect(r.body).toMatchObject({
          numero: 1,
          vehiculo: { placa: 'JKL345', kilometraje: 81234 },
          recepcion: {
            numero: 1,
            kilometraje: 81234,
            nivelCombustible: 1,
            objetosDejados: 'Silla de bebe',
            aceptacion: null,
            recibidoPor: 'Tecnico S22',
          },
          garantia: { dias: 90 },
        });
        recepcionId = r.body.recepcion.id;
      });

      it('fotos: acepta un PNG real, rechaza bytes que no son imagen', async () => {
        await comoAdmin(http().post(`/recepciones/${recepcionId}/fotos`))
          .send({ tipoMime: 'image/jpeg', datos: PNG_1X1 })
          .expect(400);
        const r = await comoAdmin(
          http().post(`/recepciones/${recepcionId}/fotos`),
        )
          .send({ tipoMime: 'image/png', datos: PNG_1X1 })
          .expect(201);
        const foto = await comoOtroCliente(
          http().get(`/recepciones/${recepcionId}/fotos/${r.body.id}`),
        ).expect(200);
        expect(foto.headers['content-type']).toBe('image/png');
      });

      it('otro cliente no ve la orden', async () => {
        await comoCliente(http().get(`/appointments/${turno}/orden`)).expect(
          404,
        );
      });

      it('en el mostrador, la aceptacion pide nombre y documento', async () => {
        await comoAdmin(http().post(`/recepciones/${recepcionId}/aceptar`))
          .send({})
          .expect(400);
      });

      it('el cliente la acepta desde su cuenta y le llega la constancia', async () => {
        const r = await comoOtroCliente(
          http().post(`/recepciones/${recepcionId}/aceptar`),
        )
          .send({})
          .expect(201);
        expect(r.body.recepcion.aceptacion).toMatchObject({ medio: 'cuenta' });
        const [notificacion] = await ds.query(
          `SELECT destinatario, estado FROM notificaciones
          WHERE turno_id = $1 AND tipo = 'constancia_recepcion'`,
          [turno],
        );
        expect(notificacion).toMatchObject({
          destinatario: `cli2-s22-${sufijo}@turnos.dev`,
        });
      });

      it('aceptada no se modifica: ni por la API ni por la base con el rol de la app', async () => {
        await comoAdmin(http().put(`/appointments/${turno}/recepcion`))
          .send({
            vehiculoId: (
              await comoAdmin(http().get(`/appointments/${turno}/orden`))
            ).body.vehiculo.id,
            kilometraje: 1,
            nivelCombustible: 0,
            estadoVehiculo: 'Otro',
          })
          .expect(409);
        await comoAdmin(http().post(`/recepciones/${recepcionId}/fotos`))
          .send({ tipoMime: 'image/png', datos: PNG_1X1 })
          .expect(409);
        await expect(
          ds.transaction(async (m) => {
            await m.query('SET LOCAL ROLE turnos_app');
            await m.query(
              `SELECT set_config('app.taller_id', $1, true),
                    set_config('app.usuario_id', $2, true),
                    set_config('app.rol', 'admin', true)`,
              [taller, adminId],
            );
            await m.query(
              'UPDATE recepciones SET kilometraje = 1 WHERE id = $1',
              [recepcionId],
            );
          }),
        ).rejects.toThrow(/ya fue aceptada/);
      });

      it('el tecnico registra inicio, fin y notas; al cerrar queda la garantia', async () => {
        await comoTecnico(http().post(`/appointments/${turno}/atencion/fin`))
          .send({})
          .expect(400);
        await comoTecnico(
          http().post(`/appointments/${turno}/atencion/inicio`),
        ).expect(201);
        await comoTecnico(
          http().post(`/appointments/${turno}/atencion/inicio`),
        ).expect(409);
        await comoTecnico(http().post(`/appointments/${turno}/atencion/fin`))
          .send({ notas: 'Cambio de pastillas delanteras.' })
          .expect(201);
        await comoTecnico(http().patch(`/appointments/${turno}/estado`))
          .send({ estado: 'atendido' })
          .expect(200);

        const r = await comoOtroCliente(
          http().get(`/appointments/${turno}/orden`),
        ).expect(200);
        expect(r.body.atencion.inicio).toBeTruthy();
        expect(r.body.atencion.fin).toBeTruthy();
        expect(r.body.atencion.notas).toBe('Cambio de pastillas delanteras.');
        expect(r.body.garantia.dias).toBe(90);
        expect(r.body.garantia.hasta).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(r.body.garantia.texto).toContain('90 dias');
        expect(r.body.garantia.texto).toContain('Decreto 735 de 2013');
      });

      it('el consecutivo sigue: la siguiente recepcion es la 2', async () => {
        const otro = await turnoEn(-5, { usuario: otroClienteId });
        const orden = await comoAdmin(
          http().get(`/appointments/${turno}/orden`),
        ).expect(200);
        const r = await comoAdmin(http().put(`/appointments/${otro}/recepcion`))
          .send({
            vehiculoId: orden.body.vehiculo.id,
            kilometraje: 81300,
            nivelCombustible: 4,
            estadoVehiculo: 'Sin novedades.',
          })
          .expect(200);
        expect(r.body.numero).toBe(2);
        // Presencial: nombre y documento de quien entrega.
        const aceptada = await comoAdmin(
          http().post(`/recepciones/${r.body.recepcion.id}/aceptar`),
        )
          .send({ nombre: 'Juan Perez', documento: 'CC 1020304050' })
          .expect(201);
        expect(aceptada.body.recepcion.aceptacion).toMatchObject({
          medio: 'presencial',
          nombre: 'Juan Perez',
          documento: 'CC 1020304050',
        });
      });

      it('"Mis turnos" muestra la recepcion y la garantia', async () => {
        const r = await comoOtroCliente(
          http().get('/appointments/mios'),
        ).expect(200);
        const t = r.body.find((x: { id: string }) => x.id === turno);
        expect(t).toMatchObject({
          estado: 'atendido',
          recepcion: { numero: 1, aceptada: true },
          garantia: { dias: 90 },
          vehiculo: { placa: 'JKL345' },
        });
      });
    });
  },
);
