import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createHash } from 'crypto';
import * as jwt from 'jsonwebtoken';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { PagosService } from '../src/modules/pagos/pagos.service';
import {
  CredencialesTaller,
  WompiCliente,
} from '../src/modules/pagos/wompi-cliente.service';
import type { TransaccionWompi } from '../src/modules/pagos/wompi.util';

/**
 * Pagos con Wompi (Sprint 24) contra Postgres real, con Wompi SIMULADO:
 * WompiCliente se reemplaza y ningun request sale a internet. Lo que se
 * prueba es lo nuestro: monto del servidor, firma de integridad, checksum
 * de eventos, idempotencia, orden de los eventos, devoluciones, turnos que
 * se liberan y el cuadre de caja.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describirSiHayDb = DATABASE_URL ? describe : describe.skip;
const SECRETO = process.env.JWT_SECRET ?? 'dev-secret-change-me';

const CREDENCIALES: CredencialesTaller = {
  ambiente: 'pruebas',
  llavePublica: 'pub_test_turnopro',
  llavePrivada: 'prv_test_turnopro',
  secretoIntegridad: 'test_integrity_turnopro',
  secretoEventos: 'test_events_turnopro',
};

const sha = (t: string) => createHash('sha256').update(t).digest('hex');

function proximo(diaIso: number): string {
  const d = new Date(Date.now() - 5 * 3_600_000);
  d.setUTCDate(d.getUTCDate() + 8);
  while (((d.getUTCDay() + 6) % 7) + 1 !== diaIso)
    d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const a = (fecha: string, hora: string) => `${fecha}T${hora}:00-05:00`;

describirSiHayDb('Pagos con Wompi (integration, Sprint 24)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let pagos: PagosService;
  const sufijo = `${Date.now()}`;
  let taller: string;
  let bahiaId: string;
  let servicioId: string;
  let tecnicoId: string;
  let adminId: string;
  let clienteId: string;
  let tokenAdmin: string;
  let tokenCliente: string;
  let timestamp = 1_800_000_000;

  // Wompi simulado: lo que "responde" la API por referencia.
  const transaccionesWompi = new Map<string, TransaccionWompi[]>();
  const anular = jest.fn(async () => ({ ok: true as const }));

  const http = () => request(app.getHttpServer());
  const comoCliente = (r: request.Test) =>
    r.set('Authorization', `Bearer ${tokenCliente}`).set('X-Taller', taller);
  const comoAdmin = (r: request.Test) =>
    r.set('Authorization', `Bearer ${tokenAdmin}`);

  /** Evento de Wompi firmado con el secreto de eventos del taller. */
  function evento(tx: TransaccionWompi, secreto = CREDENCIALES.secretoEventos) {
    timestamp += 1;
    const checksum = sha(
      `${tx.id}${tx.status}${tx.amount_in_cents}${timestamp}${secreto}`,
    );
    return {
      event: 'transaction.updated',
      data: { transaction: tx },
      environment: 'test',
      signature: {
        properties: [
          'transaction.id',
          'transaction.status',
          'transaction.amount_in_cents',
        ],
        checksum,
      },
      timestamp,
      sent_at: new Date().toISOString(),
    };
  }
  const enviar = (cuerpo: object) =>
    http().post(`/pagos/wompi/eventos/${taller}`).send(cuerpo);

  async function reservar(fecha: string, hora: string): Promise<string> {
    const r = await comoCliente(http().post('/appointments'))
      .send({ bahiaId, servicioId, tecnicoId, inicio: a(fecha, hora) })
      .expect(201);
    return r.body.id;
  }
  async function checkout(turnoId: string, concepto = 'anticipo') {
    return (
      await comoCliente(http().post('/pagos/checkout'))
        .send({ turnoId, concepto })
        .expect(201)
    ).body as { url: string; referencia: string; montoCentavos: number };
  }
  const turno = async (id: string) =>
    (
      await ds.query(
        `SELECT estado, anticipo_estado, anticipo_vence_en, cancelado_por,
                anticipo_centavos::bigint AS anticipo, total_centavos::bigint AS total
           FROM turnos WHERE id = $1`,
        [id],
      )
    )[0];
  const pago = async (referencia: string) =>
    (
      await ds.query('SELECT * FROM pagos WHERE referencia = $1', [referencia])
    )[0];

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY ??= 'a'.repeat(64);
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(WompiCliente)
      .useValue({
        credenciales: async () => CREDENCIALES,
        transaccionesPorReferencia: async (_c: unknown, ref: string) =>
          transaccionesWompi.get(ref) ?? [],
        transaccion: async () => null,
        anular,
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    ds = moduleRef.get(DataSource);
    pagos = moduleRef.get(PagosService);

    [{ id: taller }] = await ds.query(
      `INSERT INTO talleres (nombre, slug) VALUES ($1, $2) RETURNING id`,
      [`Taller pagos ${sufijo}`, `pagos-${sufijo}`],
    );
    // Solo para taller_cobra_en_linea(): los valores reales los da el doble.
    await ds.query(
      `UPDATE credenciales_taller
          SET wompi_ambiente = 'pruebas', wompi_llave_publica = 'pub_test_turnopro',
              wompi_llave_privada_cifrada = 'x', wompi_secreto_integridad_cifrado = 'x',
              wompi_secreto_eventos_cifrado = 'x'
        WHERE taller_id = $1`,
      [taller],
    );
    [{ id: bahiaId }] = await ds.query(
      `INSERT INTO bahias (nombre, taller_id) VALUES ('Bahia pagos', $1) RETURNING id`,
      [taller],
    );
    // 100.000 COP + IVA 19 % = 119.000; anticipo 50 % = 59.500.
    [{ id: servicioId }] = await ds.query(
      `INSERT INTO servicios (nombre, categoria, duracion_minutos, precio_base_centavos,
                             tarifa_iva, requiere_anticipo, porcentaje_anticipo, taller_id)
       VALUES ('Frenos', 'mecanica', 60, 10000000, 19, true, 50, $1) RETURNING id`,
      [taller],
    );
    await ds.query(
      'UPDATE configuracion_fiscal SET responsable_iva = true WHERE taller_id = $1',
      [taller],
    );
    [{ id: tecnicoId }] = await ds.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol, taller_id)
       VALUES ($1, 'hash', 'Tecnico pagos', 'tecnico', $2) RETURNING id`,
      [`tec-pagos-${sufijo}@turnos.dev`, taller],
    );
    [{ id: adminId }] = await ds.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol, taller_id)
       VALUES ($1, 'hash', 'Admin pagos', 'admin', $2) RETURNING id`,
      [`adm-pagos-${sufijo}@turnos.dev`, taller],
    );
    [{ id: clienteId }] = await ds.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol)
       VALUES ($1, 'hash', 'Cliente pagos', 'cliente') RETURNING id`,
      [`cli-pagos-${sufijo}@turnos.dev`],
    );
    await ds.query(
      'INSERT INTO clientes_taller (taller_id, usuario_id) VALUES ($1, $2)',
      [taller, clienteId],
    );
    const firmar = (p: object) => jwt.sign(p, SECRETO);
    tokenAdmin = firmar({ sub: adminId, email: 'a', rol: 'admin', taller });
    tokenCliente = firmar({
      sub: clienteId,
      email: 'cliente@turnos.dev',
      rol: 'cliente',
    });
  });

  afterAll(async () => {
    if (ds && taller) {
      await ds.query('DELETE FROM turnos WHERE taller_id = $1', [taller]);
      await ds.query('DELETE FROM servicios WHERE taller_id = $1', [taller]);
      await ds.query('DELETE FROM bahias WHERE taller_id = $1', [taller]);
      await ds.query('DELETE FROM usuarios WHERE taller_id = $1 OR id = $2', [
        taller,
        clienteId,
      ]);
      await ds.query('DELETE FROM talleres WHERE id = $1', [taller]);
    }
    await app?.close();
  });

  // Espera los efectos que corren despues del commit (devoluciones).
  const esperar = (ms = 300) => new Promise((r) => setTimeout(r, ms));

  describe('anticipo con tarjeta', () => {
    let turnoId: string;
    let ref: string;

    it('la reserva queda pendiente del anticipo, con vencimiento', async () => {
      turnoId = await reservar(proximo(1), '09:00');
      const t = await turno(turnoId);
      expect(t.anticipo_estado).toBe('pendiente');
      expect(Number(t.anticipo)).toBe(5_950_000);
      const minutos =
        (new Date(t.anticipo_vence_en).getTime() - Date.now()) / 60_000;
      expect(minutos).toBeGreaterThan(28);
      expect(minutos).toBeLessThanOrEqual(30);
    });

    it('el checkout lleva el monto y la firma del servidor, aunque el navegador mande otro', async () => {
      const r = await comoCliente(http().post('/pagos/checkout'))
        .send({ turnoId, concepto: 'anticipo', montoCentavos: 100 })
        .expect(201);
      ref = r.body.referencia;
      expect(r.body.montoCentavos).toBe(5_950_000);
      const url = new URL(r.body.url);
      const expiracion = url.searchParams.get('expiration-time')!;
      expect(url.searchParams.get('amount-in-cents')).toBe('5950000');
      expect(url.searchParams.get('signature:integrity')).toBe(
        sha(`${ref}5950000COP${expiracion}${CREDENCIALES.secretoIntegridad}`),
      );
      expect((await pago(ref)).estado).toBe('creado');
    });

    it('un evento con firma invalida no hace nada (401)', async () => {
      await enviar(
        evento(
          {
            id: 'tx-falsa',
            reference: ref,
            amount_in_cents: 5_950_000,
            currency: 'COP',
            status: 'APPROVED',
          },
          'otro_secreto',
        ),
      ).expect(401);
      expect((await pago(ref)).estado).toBe('creado');
    });

    it('la redireccion no confirma: sin evento, el pago sigue sin aprobar', async () => {
      const r = await comoCliente(
        http().get(`/pagos/referencia/${ref}`),
      ).expect(200);
      expect(r.body.estado).toBe('creado');
    });

    const aprobada = (): TransaccionWompi => ({
      id: `tx-${sufijo}-1`,
      reference: ref,
      amount_in_cents: 5_950_000,
      currency: 'COP',
      status: 'APPROVED',
      payment_method_type: 'CARD',
    });

    it('el evento APPROVED confirma el turno', async () => {
      const cuerpo = evento(aprobada());
      const r = await enviar(cuerpo).expect(200);
      expect(r.body.resultado).toBe('aprobado');
      expect((await pago(ref)).estado).toBe('aprobado');
      expect((await turno(turnoId)).anticipo_estado).toBe('pagado');

      // El mismo evento otra vez: no paga dos veces.
      const otra = await enviar(cuerpo).expect(200);
      expect(otra.body.resultado).toBe('duplicado');
      const [{ total }] = await ds.query(
        "SELECT count(*)::int AS total FROM pagos WHERE turno_id = $1 AND estado = 'aprobado'",
        [turnoId],
      );
      expect(total).toBe(1);
    });

    it('un PENDING atrasado no deshace el APPROVED', async () => {
      const r = await enviar(
        evento({ ...aprobada(), status: 'PENDING' }),
      ).expect(200);
      expect(r.body.resultado).toBe('sin_cambio');
      expect((await pago(ref)).estado).toBe('aprobado');
    });

    it('otra transaccion aprobada con la misma referencia se devuelve sola', async () => {
      const r = await enviar(
        evento({ ...aprobada(), id: `tx-${sufijo}-2` }),
      ).expect(200);
      expect(r.body.resultado).toBe('duplicado_devuelto');
      await esperar();
      const [dup] = await ds.query(
        `SELECT p.duplicado, r.motivo, r.estado FROM pagos p JOIN reembolsos r ON r.pago_id = p.id
          WHERE p.wompi_transaccion_id = $1`,
        [`tx-${sufijo}-2`],
      );
      expect(dup).toMatchObject({
        duplicado: true,
        motivo: 'pago_duplicado',
        estado: 'solicitado',
      });
      expect(anular).toHaveBeenCalledWith(CREDENCIALES, `tx-${sufijo}-2`);
    });

    it('cancelar dentro de la ventana devuelve el anticipo (anulacion de tarjeta)', async () => {
      anular.mockClear();
      await comoCliente(http().post(`/appointments/${turnoId}/cancelar`))
        .send({})
        .expect(201);
      await esperar();
      const [r] = await ds.query(
        `SELECT r.estado, r.motivo, r.via FROM reembolsos r JOIN pagos p ON p.id = r.pago_id
          WHERE p.referencia = $1`,
        [ref],
      );
      expect(r).toEqual({
        estado: 'solicitado',
        motivo: 'cancelacion_en_ventana',
        via: 'wompi_anulacion',
      });
      expect(anular).toHaveBeenCalledWith(CREDENCIALES, `tx-${sufijo}-1`);

      // Wompi confirma la anulacion.
      await enviar(evento({ ...aprobada(), status: 'VOIDED' })).expect(200);
      const [fin] = await ds.query(
        `SELECT r.estado FROM reembolsos r JOIN pagos p ON p.id = r.pago_id WHERE p.referencia = $1`,
        [ref],
      );
      expect(fin.estado).toBe('completado');
      expect((await pago(ref)).estado).toBe('anulado');
    });
  });

  describe('montos, medios sin devolucion por API y vencimiento', () => {
    it('un evento con otro monto no se da por pagado y alerta al taller', async () => {
      const turnoId = await reservar(proximo(2), '09:00');
      const { referencia } = await checkout(turnoId);
      const r = await enviar(
        evento({
          id: `tx-${sufijo}-m`,
          reference: referencia,
          amount_in_cents: 100,
          currency: 'COP',
          status: 'APPROVED',
        }),
      ).expect(200);
      expect(r.body.resultado).toBe('monto_inconsistente');
      expect((await pago(referencia)).estado).toBe('creado');
      const alertas = await comoAdmin(http().get('/pagos/alertas')).expect(200);
      expect(alertas.body.map((x: { tipo: string }) => x.tipo)).toContain(
        'monto_inconsistente',
      );
    });

    it('PSE: la devolucion queda pendiente manual y el taller la registra', async () => {
      const turnoId = await reservar(proximo(2), '11:00');
      const { referencia } = await checkout(turnoId);
      await enviar(
        evento({
          id: `tx-${sufijo}-pse`,
          reference: referencia,
          amount_in_cents: 5_950_000,
          currency: 'COP',
          status: 'APPROVED',
          payment_method_type: 'PSE',
        }),
      ).expect(200);
      // Cancela el taller: siempre se devuelve.
      await comoAdmin(http().post(`/appointments/${turnoId}/cancelar`))
        .send({ solicitadoPor: 'taller' })
        .expect(201);
      await esperar();
      const pendientes = await comoAdmin(
        http().get('/pagos/reembolsos'),
      ).expect(200);
      const r = pendientes.body.find(
        (x: { turnoId: string }) => x.turnoId === turnoId,
      );
      expect(r).toMatchObject({
        estado: 'pendiente_manual',
        via: 'manual',
        motivo: 'cancelacion_taller',
      });
      await comoAdmin(http().post(`/pagos/reembolsos/${r.id}/completar`))
        .send({ nota: 'Transferencia Bancolombia 998877' })
        .expect(204);
      const [fin] = await ds.query(
        'SELECT estado FROM reembolsos WHERE id = $1',
        [r.id],
      );
      expect(fin.estado).toBe('completado');
    });

    it('sin pago a tiempo el turno se libera; un pago tardio con el horario libre lo reactiva', async () => {
      const turnoId = await reservar(proximo(3), '09:00');
      const { referencia } = await checkout(turnoId);
      await ds.query(
        "UPDATE turnos SET anticipo_vence_en = now() - interval '1 minute' WHERE id = $1",
        [turnoId],
      );
      await pagos.liberarVencidos();
      expect(await turno(turnoId)).toMatchObject({
        estado: 'cancelado',
        cancelado_por: 'sistema',
      });

      await enviar(
        evento({
          id: `tx-${sufijo}-tarde`,
          reference: referencia,
          amount_in_cents: 5_950_000,
          currency: 'COP',
          status: 'APPROVED',
          payment_method_type: 'NEQUI',
        }),
      ).expect(200);
      expect(await turno(turnoId)).toMatchObject({
        estado: 'programado',
        anticipo_estado: 'pagado',
      });
    });

    it('la conciliacion aplica lo que Wompi informa aunque el evento no llegue', async () => {
      const turnoId = await reservar(proximo(3), '11:00');
      const { referencia } = await checkout(turnoId);
      transaccionesWompi.set(referencia, [
        {
          id: `tx-${sufijo}-conc`,
          reference: referencia,
          amount_in_cents: 5_950_000,
          currency: 'COP',
          status: 'APPROVED',
          payment_method_type: 'BANCOLOMBIA_TRANSFER',
        },
      ]);
      // El cliente vuelve del checkout: el servidor le pregunta a Wompi.
      const r = await comoCliente(
        http().get(`/pagos/referencia/${referencia}`),
      ).expect(200);
      expect(r.body.estado).toBe('aprobado');
      expect((await turno(turnoId)).anticipo_estado).toBe('pagado');
    });
  });

  describe('mostrador, caja y disputas', () => {
    let turnoId: string;

    it('el admin cobra en efectivo y el datafono pide comprobante', async () => {
      turnoId = await reservar(proximo(4), '09:00');
      await comoAdmin(http().post('/pagos/presencial'))
        .send({ turnoId, concepto: 'anticipo', medio: 'datafono' })
        .expect(400);
      await comoAdmin(http().post('/pagos/presencial'))
        .send({ turnoId, concepto: 'anticipo', medio: 'efectivo' })
        .expect(201);
      expect((await turno(turnoId)).anticipo_estado).toBe('pagado');
      // El saldo: lo que falta del total.
      const saldo = await comoAdmin(http().post('/pagos/presencial'))
        .send({ turnoId, concepto: 'saldo', medio: 'efectivo' })
        .expect(201);
      expect(saldo.body.montoCentavos).toBe(11_900_000 - 5_950_000);
      await comoAdmin(http().post('/pagos/presencial'))
        .send({ turnoId, concepto: 'saldo', medio: 'efectivo' })
        .expect(409);
    });

    it('el cuadre del dia cuenta el efectivo y se cierra una vez', async () => {
      const hoy = new Date(Date.now() - 5 * 3_600_000)
        .toISOString()
        .slice(0, 10);
      const caja = await comoAdmin(
        http().get(`/pagos/caja?fecha=${hoy}`),
      ).expect(200);
      expect(caja.body.efectivoEsperado).toBeGreaterThanOrEqual(11_900_000);
      const cierre = await comoAdmin(http().post('/pagos/caja/cierre'))
        .send({
          fecha: hoy,
          contadoCentavos: caja.body.efectivoEsperado,
          nota: 'Cuadra',
        })
        .expect(201);
      expect(cierre.body.cierre.diferenciaCentavos).toBe(0);
      await comoAdmin(http().post('/pagos/caja/cierre'))
        .send({ fecha: hoy, contadoCentavos: 0 })
        .expect(409);
    });

    it('una reversion queda en disputa y, revertida, deja de contar como pagado', async () => {
      const detalle = await comoAdmin(
        http().get(`/pagos/turno?turnoId=${turnoId}`),
      ).expect(200);
      const anticipo = detalle.body.pagos.find(
        (p: { concepto: string }) => p.concepto === 'anticipo',
      );
      await comoAdmin(http().post(`/pagos/${anticipo.id}/disputa`))
        .send({
          tipo: 'reversion',
          detalle: 'El banco aviso una reversion por Ley 1480',
        })
        .expect(204);
      await comoAdmin(http().post(`/pagos/${anticipo.id}/disputa/resolver`))
        .send({ resultado: 'revertido' })
        .expect(204);
      // Lo revertido vuelve a ser saldo por cobrar.
      const despues = await comoAdmin(
        http().get(`/pagos/turno?turnoId=${turnoId}`),
      ).expect(200);
      expect(despues.body.resumen.saldoCentavos).toBe(5_950_000);
      const alertas = await comoAdmin(http().get('/pagos/alertas')).expect(200);
      expect(alertas.body.map((x: { tipo: string }) => x.tipo)).toContain(
        'reversion',
      );
    });

    it('el cliente no registra pagos del mostrador ni ve la caja', async () => {
      await comoCliente(http().post('/pagos/presencial'))
        .send({ turnoId, concepto: 'saldo', medio: 'efectivo' })
        .expect(403);
      await comoCliente(http().get('/pagos/caja?fecha=2026-01-01')).expect(403);
    });
  });
});
