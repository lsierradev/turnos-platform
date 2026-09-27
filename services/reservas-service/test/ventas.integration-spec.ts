import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as jwt from 'jsonwebtoken';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { EMAIL_PROVIDER } from '../src/modules/notifications/providers/provider.tokens';

/**
 * Orden de venta (Sprint 26) contra Postgres real: servicios del turno con
 * el precio guardado, repuestos con descuento (y su tope), IVA por
 * tarifa, el anticipo ya pagado descontado del total, el ciclo completo de
 * estados (con la protecccion de stock del Sprint 25 tambien desde aca) y
 * la cotizacion por correo.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describirSiHayDb = DATABASE_URL ? describe : describe.skip;
const SECRETO = process.env.JWT_SECRET ?? 'dev-secret-change-me';

describirSiHayDb('Orden de venta (integration, Sprint 26)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let correo: { enviar: jest.Mock };
  const sufijo = `${Date.now()}`;
  let taller: string;
  let bahiaId: string;
  let servicioId: string;
  let tecnicoId: string;
  let adminId: string;
  let clienteId: string;
  let clienteEmail: string;
  let otroClienteId: string;
  let tokenAdmin: string;
  let tokenTecnico: string;
  let tokenCliente: string;
  let tokenOtroCliente: string;

  const http = () => request(app.getHttpServer());
  const comoAdmin = (r: request.Test) =>
    r.set('Authorization', `Bearer ${tokenAdmin}`);
  const comoTecnico = (r: request.Test) =>
    r.set('Authorization', `Bearer ${tokenTecnico}`);
  const comoCliente = (r: request.Test) =>
    r.set('Authorization', `Bearer ${tokenCliente}`);
  const comoOtroCliente = (r: request.Test) =>
    r.set('Authorization', `Bearer ${tokenOtroCliente}`);

  async function turnoPara(usuarioId: string, minutos = 60): Promise<string> {
    const [{ id }] = await ds.query(
      `INSERT INTO turnos (taller_id, bahia_id, servicio_id, tecnico_id, usuario_id, rango_tiempo,
                          precio_base_centavos, iva_centavos, total_centavos, tarifa_iva)
       VALUES ($1, $2, $3, $4, $5,
               tstzrange(now() + make_interval(mins => $6), now() + make_interval(mins => $6 + 30), '[)'),
               8000000, 1520000, 9520000, 19)
       RETURNING id`,
      [taller, bahiaId, servicioId, tecnicoId, usuarioId, minutos],
    );
    return id as string;
  }

  async function crearItem(
    sku: string,
    precioBaseCentavos = 2_500_000,
    stockMinimo = 0,
  ) {
    const r = await comoAdmin(http().post('/inventario/items'))
      .send({
        sku,
        nombre: `Repuesto ${sku}`,
        precioBaseCentavos,
        tarifaIva: 19,
        stockMinimo,
      })
      .expect(201);
    return r.body as { id: string };
  }

  async function entrar(itemId: string, cantidad: number) {
    await comoAdmin(http().post('/inventario/movimientos'))
      .send({
        itemId,
        tipo: 'entrada',
        cantidad,
        costoUnitarioCentavos: 1_000_000,
        proveedor: 'Proveedor de prueba',
        facturaProveedor: 'FE-1',
      })
      .expect(201);
  }

  async function stockDe(itemId: string): Promise<number> {
    const [{ stock }] = await ds.query(
      `SELECT coalesce(sum(cantidad), 0)::float AS stock FROM movimientos_inventario WHERE item_id = $1`,
      [itemId],
    );
    return Number(stock);
  }

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY ??= 'a'.repeat(64);
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EMAIL_PROVIDER)
      .useValue({ enviar: jest.fn(async () => undefined) })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    ds = moduleRef.get(DataSource);
    correo = moduleRef.get(EMAIL_PROVIDER);

    [{ id: taller }] = await ds.query(
      `INSERT INTO talleres (nombre, slug) VALUES ($1, $2) RETURNING id`,
      [`Taller ventas ${sufijo}`, `ventas-${sufijo}`],
    );
    await ds.query(
      'UPDATE configuracion_fiscal SET responsable_iva = true WHERE taller_id = $1',
      [taller],
    );
    await ds.query(
      'UPDATE politica_cancelacion SET descuento_maximo_porcentaje = 20 WHERE taller_id = $1',
      [taller],
    );
    [{ id: bahiaId }] = await ds.query(
      `INSERT INTO bahias (nombre, taller_id) VALUES ('Bahia ventas', $1) RETURNING id`,
      [taller],
    );
    [{ id: servicioId }] = await ds.query(
      `INSERT INTO servicios (nombre, categoria, duracion_minutos, precio_base_centavos, taller_id)
       VALUES ('Cambio de aceite', 'mecanica', 60, 8000000, $1) RETURNING id`,
      [taller],
    );
    [{ id: adminId }] = await ds.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol, taller_id)
       VALUES ($1, 'hash', 'Admin ventas', 'admin', $2) RETURNING id`,
      [`adm-vta-${sufijo}@turnos.dev`, taller],
    );
    [{ id: tecnicoId }] = await ds.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol, taller_id)
       VALUES ($1, 'hash', 'Tecnico ventas', 'tecnico', $2) RETURNING id`,
      [`tec-vta-${sufijo}@turnos.dev`, taller],
    );
    clienteEmail = `cli-vta-${sufijo}@turnos.dev`;
    [{ id: clienteId }] = await ds.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol)
       VALUES ($1, 'hash', 'Maria Cliente', 'cliente') RETURNING id`,
      [clienteEmail],
    );
    [{ id: otroClienteId }] = await ds.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol)
       VALUES ($1, 'hash', 'Jorge Otro', 'cliente') RETURNING id`,
      [`cli2-vta-${sufijo}@turnos.dev`],
    );
    await ds.query(
      'INSERT INTO clientes_taller (taller_id, usuario_id) VALUES ($1, $2), ($1, $3)',
      [taller, clienteId, otroClienteId],
    );
    const firmar = (p: object) => jwt.sign(p, SECRETO);
    tokenAdmin = firmar({ sub: adminId, email: 'a', rol: 'admin', taller });
    tokenTecnico = firmar({
      sub: tecnicoId,
      email: 't',
      rol: 'tecnico',
      taller,
    });
    tokenCliente = firmar({
      sub: clienteId,
      email: 'cliente@turnos.dev',
      rol: 'cliente',
    });
    tokenOtroCliente = firmar({
      sub: otroClienteId,
      email: 'otro@turnos.dev',
      rol: 'cliente',
    });
  });

  afterAll(async () => {
    if (ds) {
      await ds.query(
        'DELETE FROM movimientos_inventario WHERE taller_id = $1',
        [taller],
      );
      await ds.query('DELETE FROM ordenes_venta WHERE taller_id = $1', [
        taller,
      ]);
      await ds.query('DELETE FROM items_inventario WHERE taller_id = $1', [
        taller,
      ]);
      await ds.query('DELETE FROM turnos WHERE taller_id = $1', [taller]);
      await ds.query('DELETE FROM servicios WHERE taller_id = $1', [taller]);
      await ds.query('DELETE FROM bahias WHERE taller_id = $1', [taller]);
      await ds.query(
        'DELETE FROM usuarios WHERE taller_id = $1 OR id = ANY($2)',
        [taller, [clienteId, otroClienteId]],
      );
      await ds.query('DELETE FROM talleres WHERE id = $1', [taller]);
    }
    await app?.close();
  });

  describe('crear y armar la orden', () => {
    it('desde un turno: agrega solo la linea del servicio, con el precio guardado', async () => {
      const turnoId = await turnoPara(clienteId);
      const r = await comoAdmin(http().post('/ventas'))
        .send({ turnoId })
        .expect(201);
      expect(r.body).toMatchObject({
        estado: 'borrador',
        turnoId,
        usuarioId: clienteId,
      });
      expect(r.body.lineas).toHaveLength(1);
      expect(r.body.lineas[0]).toMatchObject({
        tipo: 'servicio',
        descripcion: 'Cambio de aceite',
        cantidad: 1,
        totalCentavos: 9_520_000, // el del turno, no el del catalogo (que podria haber cambiado).
      });
      expect(r.body.totales).toMatchObject({
        totalCentavos: 9_520_000,
        anticipoCentavos: 0,
      });
    });

    it('de mostrador, sin turno: el admin elige el cliente', async () => {
      const r = await comoAdmin(http().post('/ventas'))
        .send({ usuarioId: clienteId })
        .expect(201);
      expect(r.body).toMatchObject({
        estado: 'borrador',
        turnoId: null,
        usuarioId: clienteId,
        lineas: [],
      });
    });

    it('un cliente no crea ordenes', async () => {
      await comoCliente(http().post('/ventas')).send({}).expect(403);
    });

    it('descuento por linea con tope: lo dentro del tope se guarda, lo que lo pasa se rechaza', async () => {
      const item = await crearItem(`REP-${sufijo}-1`);
      const orden = await comoAdmin(http().post('/ventas'))
        .send({})
        .expect(201);
      const conDescuento = await comoAdmin(
        http().post(`/ventas/${orden.body.id}/lineas/repuesto`),
      )
        .send({ itemId: item.id, cantidad: 2, descuentoPorcentaje: 20 })
        .expect(201);
      const linea = conDescuento.body.lineas[0];
      expect(linea).toMatchObject({
        tipo: 'repuesto',
        cantidad: 2,
        baseCentavos: 5_000_000, // 2.500.000 x 2
        descuentoCentavos: 1_000_000, // 20% de 5.000.000
        baseConDescuentoCentavos: 4_000_000,
      });

      await comoAdmin(http().post(`/ventas/${orden.body.id}/lineas/repuesto`))
        .send({ itemId: item.id, cantidad: 1, descuentoPorcentaje: 21 })
        .expect(400);
    });

    it('quien aplico el descuento queda registrado, y se borra si el descuento vuelve a 0', async () => {
      const item = await crearItem(`REP-${sufijo}-2`);
      const orden = await comoAdmin(http().post('/ventas'))
        .send({})
        .expect(201);
      const conLinea = await comoAdmin(
        http().post(`/ventas/${orden.body.id}/lineas/repuesto`),
      )
        .send({ itemId: item.id, cantidad: 1, descuentoPorcentaje: 10 })
        .expect(201);
      const lineaId = conLinea.body.lineas[0].id;
      expect(conLinea.body.lineas[0].descuentoAplicadoPorNombre).toBe(
        'Admin ventas',
      );

      const sinDescuento = await comoAdmin(
        http().patch(`/ventas/${orden.body.id}/lineas/${lineaId}`),
      )
        .send({ descuentoPorcentaje: 0 })
        .expect(200);
      expect(sinDescuento.body.lineas[0].descuentoAplicadoPor).toBeNull();
    });

    it('el admin tambien agrega un servicio a mano (mostrador)', async () => {
      const orden = await comoAdmin(http().post('/ventas'))
        .send({})
        .expect(201);
      const r = await comoAdmin(
        http().post(`/ventas/${orden.body.id}/lineas/servicio`),
      )
        .send({ servicioId })
        .expect(201);
      expect(r.body.lineas[0]).toMatchObject({
        tipo: 'servicio',
        totalCentavos: 9_520_000,
      });
    });

    it('borrar una linea la saca de la orden', async () => {
      const item = await crearItem(`REP-${sufijo}-3`);
      const orden = await comoAdmin(http().post('/ventas'))
        .send({})
        .expect(201);
      const conLinea = await comoAdmin(
        http().post(`/ventas/${orden.body.id}/lineas/repuesto`),
      )
        .send({ itemId: item.id, cantidad: 1 })
        .expect(201);
      const lineaId = conLinea.body.lineas[0].id;
      const r = await comoAdmin(
        http().delete(`/ventas/${orden.body.id}/lineas/${lineaId}`),
      ).expect(200);
      expect(r.body.lineas).toHaveLength(0);
    });
  });

  describe('confirmar: descuenta stock y congela los totales', () => {
    it('no confirma sin lineas', async () => {
      const orden = await comoAdmin(http().post('/ventas'))
        .send({})
        .expect(201);
      await comoAdmin(http().post(`/ventas/${orden.body.id}/confirmar`)).expect(
        400,
      );
    });

    it('descuenta el anticipo ya pagado y el stock del repuesto', async () => {
      const turnoId = await turnoPara(clienteId, 120);
      await ds.query(
        `INSERT INTO pagos (taller_id, turno_id, usuario_id, concepto, canal, monto_centavos,
                           estado, metodo, registrado_por)
         VALUES ($1, $2, $3, 'anticipo', 'efectivo', 2000000, 'aprobado', 'efectivo', $4)`,
        [taller, turnoId, clienteId, adminId],
      );
      const item = await crearItem(`REP-${sufijo}-4`);
      await entrar(item.id, 5);

      const orden = await comoAdmin(http().post('/ventas'))
        .send({ turnoId })
        .expect(201);
      await comoAdmin(http().post(`/ventas/${orden.body.id}/lineas/repuesto`))
        .send({ itemId: item.id, cantidad: 2 })
        .expect(201);

      const confirmada = await comoAdmin(
        http().post(`/ventas/${orden.body.id}/confirmar`),
      ).expect(201);
      // Servicio 9.520.000 + repuesto 2 x 2.500.000 x 1,19 = 5.950.000 -> total 15.470.000.
      expect(confirmada.body).toMatchObject({
        estado: 'confirmada',
        congelado: true,
        totales: {
          totalCentavos: 15_470_000,
          anticipoCentavos: 2_000_000,
          saldoCentavos: 13_470_000,
        },
      });
      expect(await stockDe(item.id)).toBe(3);

      // Una orden confirmada no se vuelve a confirmar, y sus lineas ya no se tocan.
      await comoAdmin(http().post(`/ventas/${orden.body.id}/confirmar`)).expect(
        409,
      );
      await comoAdmin(http().post(`/ventas/${orden.body.id}/lineas/repuesto`))
        .send({ itemId: item.id, cantidad: 1 })
        .expect(409);
    });

    it('sin stock suficiente, no confirma nada (ninguna linea queda descontada)', async () => {
      const item1 = await crearItem(`REP-${sufijo}-5a`);
      const item2 = await crearItem(`REP-${sufijo}-5b`);
      await entrar(item1.id, 10);
      await entrar(item2.id, 1);

      const orden = await comoAdmin(http().post('/ventas'))
        .send({})
        .expect(201);
      await comoAdmin(http().post(`/ventas/${orden.body.id}/lineas/repuesto`))
        .send({ itemId: item1.id, cantidad: 3 })
        .expect(201);
      await comoAdmin(http().post(`/ventas/${orden.body.id}/lineas/repuesto`))
        .send({ itemId: item2.id, cantidad: 5 }) // solo hay 1
        .expect(201);

      const r = await comoAdmin(
        http().post(`/ventas/${orden.body.id}/confirmar`),
      );
      expect(r.status).toBe(409);
      expect(await stockDe(item1.id)).toBe(10); // intacto: no se descuenta nada si algo falla.
      expect(await stockDe(item2.id)).toBe(1);
      await comoAdmin(http().get(`/ventas/${orden.body.id}`))
        .expect(200)
        .expect((res) => {
          expect(res.body.estado).toBe('borrador');
        });
    });
  });

  describe('pagar y anular', () => {
    it('anular una orden confirmada devuelve el stock (con una devolucion, no corrigiendo la salida)', async () => {
      const item = await crearItem(`REP-${sufijo}-6`);
      await entrar(item.id, 4);
      const orden = await comoAdmin(http().post('/ventas'))
        .send({})
        .expect(201);
      await comoAdmin(http().post(`/ventas/${orden.body.id}/lineas/repuesto`))
        .send({ itemId: item.id, cantidad: 4 })
        .expect(201);
      await comoAdmin(http().post(`/ventas/${orden.body.id}/confirmar`)).expect(
        201,
      );
      expect(await stockDe(item.id)).toBe(0);

      await comoAdmin(http().post(`/ventas/${orden.body.id}/anular`))
        .send({ motivo: 'x' })
        .expect(400); // motivo muy corto.
      const anulada = await comoAdmin(
        http().post(`/ventas/${orden.body.id}/anular`),
      )
        .send({ motivo: 'El cliente se arrepintio del repuesto' })
        .expect(201);
      expect(anulada.body.estado).toBe('anulada');
      expect(await stockDe(item.id)).toBe(4);

      const kardex = await comoAdmin(
        http().get(`/inventario/movimientos?itemId=${item.id}`),
      ).expect(200);
      expect(kardex.body.map((m: { tipo: string }) => m.tipo)).toEqual([
        'entrada',
        'salida',
        'devolucion',
      ]);
    });

    it('pagada solo desde confirmada; anular tambien desde pagada', async () => {
      const orden = await comoAdmin(http().post('/ventas'))
        .send({})
        .expect(201);
      await comoAdmin(http().post(`/ventas/${orden.body.id}/lineas/servicio`))
        .send({ servicioId })
        .expect(201);
      await comoAdmin(http().post(`/ventas/${orden.body.id}/pagar`))
        .send({ medioPago: 'efectivo' })
        .expect(409); // todavia en borrador.

      await comoAdmin(http().post(`/ventas/${orden.body.id}/confirmar`)).expect(
        201,
      );
      const pagada = await comoAdmin(
        http().post(`/ventas/${orden.body.id}/pagar`),
      )
        .send({ medioPago: 'efectivo' })
        .expect(201);
      expect(pagada.body).toMatchObject({
        estado: 'pagada',
        medioPago: 'efectivo',
      });

      const anulada = await comoAdmin(
        http().post(`/ventas/${orden.body.id}/anular`),
      )
        .send({ motivo: 'Se devolvio el dinero al cliente' })
        .expect(201);
      expect(anulada.body.estado).toBe('anulada');
      // Se pago Y se anulo: las dos cosas quedan.
      expect(anulada.body.pagadaEn).not.toBeNull();
    });

    it('un borrador se borra, no se anula ni se paga', async () => {
      const orden = await comoAdmin(http().post('/ventas'))
        .send({})
        .expect(201);
      await comoAdmin(http().post(`/ventas/${orden.body.id}/anular`))
        .send({ motivo: 'no aplica aca' })
        .expect(409);
      await comoAdmin(http().delete(`/ventas/${orden.body.id}`)).expect(204);
      await comoAdmin(http().get(`/ventas/${orden.body.id}`)).expect(404);
    });
  });

  describe('cotizacion', () => {
    it('se envia por correo, y no se puede confirmar hasta que el cliente la acepta', async () => {
      const orden = await comoAdmin(http().post('/ventas'))
        .send({ usuarioId: clienteId })
        .expect(201);
      await comoAdmin(http().post(`/ventas/${orden.body.id}/lineas/servicio`))
        .send({ servicioId })
        .expect(201);

      correo.enviar.mockClear();
      const r = await comoAdmin(
        http().post(`/ventas/${orden.body.id}/cotizacion/enviar`),
      ).expect(201);
      expect(r.body.enviado).toBe(true);
      expect(correo.enviar).toHaveBeenCalledTimes(1);
      const [{ destinatario, asunto }] = correo.enviar.mock.calls[0];
      expect(destinatario).toBe(clienteEmail);
      expect(asunto).toContain('Cotizacion');

      await comoAdmin(http().post(`/ventas/${orden.body.id}/confirmar`)).expect(
        409,
      );

      // Otro cliente no puede aceptar la cotizacion ajena.
      await comoOtroCliente(
        http().post(`/ventas/${orden.body.id}/cotizacion/aceptar`),
      ).expect(404);

      await comoCliente(
        http().post(`/ventas/${orden.body.id}/cotizacion/aceptar`),
      ).expect(201);
      // Aceptarla dos veces no rompe nada, simplemente ya no hay nada que aceptar.
      await comoCliente(
        http().post(`/ventas/${orden.body.id}/cotizacion/aceptar`),
      ).expect(404);

      const confirmada = await comoAdmin(
        http().post(`/ventas/${orden.body.id}/confirmar`),
      ).expect(201);
      expect(confirmada.body.estado).toBe('confirmada');
    });

    it('sin un cliente con correo, no se puede cotizar', async () => {
      const orden = await comoAdmin(http().post('/ventas'))
        .send({})
        .expect(201);
      await comoAdmin(
        http().post(`/ventas/${orden.body.id}/cotizacion/enviar`),
      ).expect(400);
    });

    it('el cliente ve su propia orden; el tecnico no ve ninguna', async () => {
      const orden = await comoAdmin(http().post('/ventas'))
        .send({ usuarioId: clienteId })
        .expect(201);
      await comoCliente(http().get(`/ventas/${orden.body.id}`)).expect(200);
      await comoOtroCliente(http().get(`/ventas/${orden.body.id}`)).expect(404);
      await comoTecnico(http().get(`/ventas/${orden.body.id}`)).expect(403);
    });
  });

  describe('concurrencia: confirmar dos ordenes por el mismo repuesto', () => {
    it('con stock para una sola, una se confirma y la otra se rechaza', async () => {
      const item = await crearItem(`REP-${sufijo}-CONC`);
      await entrar(item.id, 5);

      const ordenA = await comoAdmin(http().post('/ventas'))
        .send({})
        .expect(201);
      const ordenB = await comoAdmin(http().post('/ventas'))
        .send({})
        .expect(201);
      await comoAdmin(http().post(`/ventas/${ordenA.body.id}/lineas/repuesto`))
        .send({ itemId: item.id, cantidad: 3 })
        .expect(201);
      await comoAdmin(http().post(`/ventas/${ordenB.body.id}/lineas/repuesto`))
        .send({ itemId: item.id, cantidad: 3 })
        .expect(201);

      const [rA, rB] = await Promise.all([
        comoAdmin(http().post(`/ventas/${ordenA.body.id}/confirmar`)),
        comoAdmin(http().post(`/ventas/${ordenB.body.id}/confirmar`)),
      ]);
      const estados = [rA.status, rB.status].sort();
      expect(estados).toEqual([201, 409]);
      // Exactamente una de las dos quedo confirmada, y el stock cuadra con esa sola.
      expect(await stockDe(item.id)).toBe(2);
    });
  });
});
