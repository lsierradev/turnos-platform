import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as jwt from 'jsonwebtoken';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

/**
 * Inventario de repuestos (Sprint 25) contra Postgres real: catalogo,
 * movimientos de kardex, kardex, valorizacion, alerta de stock bajo y, lo
 * que mas importa, que el stock nunca quede negativo aunque dos ventas del
 * mismo repuesto lleguen a la vez (el trigger de la migracion 020).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describirSiHayDb = DATABASE_URL ? describe : describe.skip;
const SECRETO = process.env.JWT_SECRET ?? 'dev-secret-change-me';

describirSiHayDb('Inventario de repuestos (integration, Sprint 25)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const sufijo = `${Date.now()}`;
  let taller: string;
  let otroTaller: string;
  let bahiaId: string;
  let servicioId: string;
  let tecnicoId: string;
  let otroTecnicoId: string;
  let adminId: string;
  let clienteId: string;
  let tokenAdmin: string;
  let tokenTecnico: string;
  let tokenOtroTecnico: string;
  let tokenCliente: string;

  const http = () => request(app.getHttpServer());
  const comoAdmin = (r: request.Test) =>
    r.set('Authorization', `Bearer ${tokenAdmin}`);
  const comoTecnico = (r: request.Test) =>
    r.set('Authorization', `Bearer ${tokenTecnico}`);
  const comoOtroTecnico = (r: request.Test) =>
    r.set('Authorization', `Bearer ${tokenOtroTecnico}`);
  const comoCliente = (r: request.Test) =>
    r.set('Authorization', `Bearer ${tokenCliente}`);

  async function crearItem(
    over: Partial<{
      sku: string;
      nombre: string;
      precioBaseCentavos: number;
      stockMinimo: number;
    }> = {},
  ) {
    const r = await comoAdmin(http().post('/inventario/items'))
      .send({
        sku: over.sku ?? `FIL-${Math.random().toString(36).slice(2, 8)}`,
        nombre: over.nombre ?? 'Filtro de aceite',
        marca: 'Bosch',
        unidad: 'unidad',
        precioBaseCentavos: over.precioBaseCentavos ?? 2_500_000,
        tarifaIva: 19,
        stockMinimo: over.stockMinimo ?? 2,
      })
      .expect(201);
    return r.body as { id: string; stock: number };
  }

  async function turnoDe(
    tecnico: string | null,
    usuario = clienteId,
    minutos = 60,
  ): Promise<string> {
    const [{ id }] = await ds.query(
      `INSERT INTO turnos (taller_id, bahia_id, servicio_id, tecnico_id, usuario_id, rango_tiempo)
       VALUES ($1, $2, $3, $4, $5,
               tstzrange(now() + make_interval(mins => $6), now() + make_interval(mins => $6 + 30), '[)'))
       RETURNING id`,
      [taller, bahiaId, servicioId, tecnico, usuario, minutos],
    );
    return id as string;
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
      [`Taller inventario ${sufijo}`, `inventario-${sufijo}`],
    );
    [{ id: otroTaller }] = await ds.query(
      `INSERT INTO talleres (nombre, slug) VALUES ($1, $2) RETURNING id`,
      [`Otro inventario ${sufijo}`, `inventario-otro-${sufijo}`],
    );
    // Responsable de IVA: los precios con IVA incluido se ven en el
    // catalogo igual que en los servicios (regla del Sprint 21/25).
    await ds.query(
      'UPDATE configuracion_fiscal SET responsable_iva = true WHERE taller_id = $1',
      [taller],
    );
    [{ id: bahiaId }] = await ds.query(
      `INSERT INTO bahias (nombre, taller_id) VALUES ('Bahia inventario', $1) RETURNING id`,
      [taller],
    );
    [{ id: servicioId }] = await ds.query(
      `INSERT INTO servicios (nombre, categoria, duracion_minutos, precio_base_centavos, taller_id)
       VALUES ('Cambio de aceite', 'mecanica', 60, 5000000, $1) RETURNING id`,
      [taller],
    );
    [{ id: adminId }] = await ds.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol, taller_id)
       VALUES ($1, 'hash', 'Admin inventario', 'admin', $2) RETURNING id`,
      [`adm-inv-${sufijo}@turnos.dev`, taller],
    );
    [{ id: tecnicoId }] = await ds.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol, taller_id)
       VALUES ($1, 'hash', 'Tecnico inventario', 'tecnico', $2) RETURNING id`,
      [`tec-inv-${sufijo}@turnos.dev`, taller],
    );
    [{ id: otroTecnicoId }] = await ds.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol, taller_id)
       VALUES ($1, 'hash', 'Otro tecnico inventario', 'tecnico', $2) RETURNING id`,
      [`tec2-inv-${sufijo}@turnos.dev`, taller],
    );
    [{ id: clienteId }] = await ds.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol)
       VALUES ($1, 'hash', 'Cliente inventario', 'cliente') RETURNING id`,
      [`cli-inv-${sufijo}@turnos.dev`],
    );
    const firmar = (p: object) => jwt.sign(p, SECRETO);
    tokenAdmin = firmar({ sub: adminId, email: 'a', rol: 'admin', taller });
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
  });

  afterAll(async () => {
    if (ds) {
      await ds.query(
        'DELETE FROM movimientos_inventario WHERE taller_id = ANY($1)',
        [[taller, otroTaller]],
      );
      await ds.query('DELETE FROM items_inventario WHERE taller_id = ANY($1)', [
        [taller, otroTaller],
      ]);
      await ds.query('DELETE FROM turnos WHERE taller_id = ANY($1)', [
        [taller, otroTaller],
      ]);
      await ds.query('DELETE FROM servicios WHERE taller_id = $1', [taller]);
      await ds.query('DELETE FROM bahias WHERE taller_id = $1', [taller]);
      await ds.query(
        'DELETE FROM usuarios WHERE taller_id = ANY($1) OR id = $2',
        [[taller, otroTaller], clienteId],
      );
      await ds.query('DELETE FROM talleres WHERE id = ANY($1)', [
        [taller, otroTaller],
      ]);
    }
    await app?.close();
  });

  describe('catalogo', () => {
    it('el admin crea un repuesto; el cliente no puede', async () => {
      const item = await crearItem({ sku: `CAT-${sufijo}-1` });
      expect(item).toMatchObject({
        sku: `CAT-${sufijo}-1`,
        stock: 0,
        costoCentavos: 0,
        precio: { totalCentavos: 2_975_000 },
      });
      await comoCliente(http().post('/inventario/items'))
        .send({ sku: 'x', nombre: 'x', precioBaseCentavos: 100 })
        .expect(403);
    });

    it('el mismo codigo dos veces en el mismo taller: 409', async () => {
      const sku = `DUP-${sufijo}`;
      await crearItem({ sku });
      const r = await comoAdmin(http().post('/inventario/items')).send({
        sku,
        nombre: 'Otro nombre',
        precioBaseCentavos: 1000,
      });
      expect(r.status).toBe(409);
    });

    it('el tecnico lista el catalogo pero no lo edita', async () => {
      const item = await crearItem({ sku: `TEC-${sufijo}` });
      const lista = await comoTecnico(http().get('/inventario/items')).expect(
        200,
      );
      expect(lista.body.some((i: { id: string }) => i.id === item.id)).toBe(
        true,
      );
      await comoTecnico(http().patch(`/inventario/items/${item.id}`))
        .send({ nombre: 'x' })
        .expect(403);
    });

    it('un item de otro taller no existe para este admin (404, no 403)', async () => {
      const [{ id: ajeno }] = await ds.query(
        `INSERT INTO items_inventario (taller_id, sku, nombre, precio_base_centavos)
         VALUES ($1, 'AJENO', 'Ajeno', 1000) RETURNING id`,
        [otroTaller],
      );
      await comoAdmin(http().patch(`/inventario/items/${ajeno}`))
        .send({ nombre: 'x' })
        .expect(404);
    });
  });

  describe('movimientos', () => {
    it('entrada: exige proveedor, factura y costo; sube el stock y actualiza el costo', async () => {
      const item = await crearItem({ sku: `ENT-${sufijo}` });
      await comoAdmin(http().post('/inventario/movimientos'))
        .send({ itemId: item.id, tipo: 'entrada', cantidad: 10 })
        .expect(400); // faltan proveedor, factura y costo

      const r = await comoAdmin(http().post('/inventario/movimientos'))
        .send({
          itemId: item.id,
          tipo: 'entrada',
          cantidad: 10,
          costoUnitarioCentavos: 1_500_000,
          proveedor: 'Repuestos SA',
          facturaProveedor: 'FE-001',
        })
        .expect(201);
      expect(r.body.movimiento).toMatchObject({
        tipo: 'entrada',
        cantidad: 10,
      });
      expect(r.body.item).toMatchObject({
        stock: 10,
        costoCentavos: 1_500_000,
      });

      // Una segunda entrada a otro costo actualiza el costo (ultima compra).
      await comoAdmin(http().post('/inventario/movimientos')).send({
        itemId: item.id,
        tipo: 'entrada',
        cantidad: 5,
        costoUnitarioCentavos: 1_800_000,
        proveedor: 'Repuestos SA',
        facturaProveedor: 'FE-002',
      });
      const catalogo = await comoAdmin(http().get('/inventario/items')).expect(
        200,
      );
      const actualizado = catalogo.body.find(
        (i: { id: string }) => i.id === item.id,
      );
      expect(actualizado).toMatchObject({
        stock: 15,
        costoCentavos: 1_800_000,
      });
    });

    it('ajuste: exige motivo de al menos 5 caracteres y respeta el sentido', async () => {
      const item = await crearItem({ sku: `AJU-${sufijo}` });
      await entrar(item.id, 5);

      await comoAdmin(http().post('/inventario/movimientos'))
        .send({
          itemId: item.id,
          tipo: 'ajuste',
          cantidad: 1,
          sentido: 'decremento',
          motivo: 'x',
        })
        .expect(400);

      await comoAdmin(http().post('/inventario/movimientos'))
        .send({
          itemId: item.id,
          tipo: 'ajuste',
          cantidad: 1,
          sentido: 'decremento',
          motivo: 'Se rompio uno en la bodega',
        })
        .expect(201);
      const [{ stock }] = (
        await comoAdmin(http().get('/inventario/items')).expect(200)
      ).body.filter((i: { id: string }) => i.id === item.id);
      expect(stock).toBe(4);
    });

    it('devolucion: suma stock de nuevo', async () => {
      const item = await crearItem({ sku: `DEV-${sufijo}` });
      await entrar(item.id, 3);
      await venderDeMostrador(item.id, 2);
      await comoAdmin(http().post('/inventario/movimientos'))
        .send({
          itemId: item.id,
          tipo: 'devolucion',
          cantidad: 1,
          motivo: 'El cliente lo devolvio',
        })
        .expect(201);
      expect(await stockDe(item.id)).toBe(2);
    });

    it('salida sin stock suficiente: 409, y el stock no cambia', async () => {
      const item = await crearItem({ sku: `INS-${sufijo}` });
      await entrar(item.id, 1);
      const r = await comoAdmin(http().post('/inventario/movimientos')).send({
        itemId: item.id,
        tipo: 'salida',
        cantidad: 2,
      });
      expect(r.status).toBe(409);
      expect(r.body.message).toMatch(/stock insuficiente/i);
      expect(await stockDe(item.id)).toBe(1);
    });

    it('el tecnico solo registra salidas de un turno suyo', async () => {
      const item = await crearItem({ sku: `TUR-${sufijo}` });
      await entrar(item.id, 5);
      const miTurno = await turnoDe(tecnicoId);
      const turnoAjeno = await turnoDe(otroTecnicoId);

      // Sin turno: venta de mostrador, prohibida para el tecnico.
      await comoTecnico(http().post('/inventario/movimientos'))
        .send({ itemId: item.id, tipo: 'salida', cantidad: 1 })
        .expect(403);

      // El turno de otro tecnico, tampoco.
      await comoTecnico(http().post('/inventario/movimientos'))
        .send({
          itemId: item.id,
          tipo: 'salida',
          cantidad: 1,
          turnoId: turnoAjeno,
        })
        .expect(403);

      // El propio, si.
      await comoTecnico(http().post('/inventario/movimientos'))
        .send({
          itemId: item.id,
          tipo: 'salida',
          cantidad: 1,
          turnoId: miTurno,
        })
        .expect(201);
      expect(await stockDe(item.id)).toBe(4);

      // Y lo mismo vale para cualquier tecnico con SU propio turno, no es
      // un permiso especial del primero.
      await comoOtroTecnico(http().post('/inventario/movimientos'))
        .send({
          itemId: item.id,
          tipo: 'salida',
          cantidad: 1,
          turnoId: turnoAjeno,
        })
        .expect(201);
      expect(await stockDe(item.id)).toBe(3);

      // Y queda visible en los repuestos de ESE turno.
      const usados = await comoAdmin(
        http().get(`/inventario/movimientos/turno/${miTurno}`),
      ).expect(200);
      expect(usados.body).toHaveLength(1);
      expect(usados.body[0]).toMatchObject({
        tipo: 'salida',
        turnoId: miTurno,
        itemNombre: 'Filtro de aceite',
      });
    });

    it('el kardex trae el saldo despues de cada movimiento', async () => {
      const item = await crearItem({ sku: `KAR-${sufijo}` });
      await entrar(item.id, 10, 'FE-100');
      await venderDeMostrador(item.id, 3);
      await entrar(item.id, 2, 'FE-101');
      const r = await comoAdmin(
        http().get(`/inventario/movimientos?itemId=${item.id}`),
      ).expect(200);
      expect(r.body.map((m: { saldo: number }) => m.saldo)).toEqual([10, 7, 9]);
      await comoTecnico(
        http().get(`/inventario/movimientos?itemId=${item.id}`),
      ).expect(403);
    });
  });

  describe('reportes', () => {
    it('valorizacion suma stock * costo de cada item', async () => {
      const a = await crearItem({ sku: `VAL-A-${sufijo}` });
      const b = await crearItem({ sku: `VAL-B-${sufijo}` });
      await entrar(a.id, 4, 'FA', 1_000_000);
      await entrar(b.id, 2, 'FB', 3_000_000);
      const r = await comoAdmin(http().get('/inventario/valorizacion')).expect(
        200,
      );
      const va = r.body.items.find((i: { id: string }) => i.id === a.id);
      const vb = r.body.items.find((i: { id: string }) => i.id === b.id);
      expect(va.valorCentavos).toBe(4_000_000);
      expect(vb.valorCentavos).toBe(6_000_000);
      expect(r.body.totalCentavos).toBeGreaterThanOrEqual(10_000_000);
    });

    it('alerta de stock bajo: solo lo que quedo en o por debajo del minimo', async () => {
      const bajo = await crearItem({ sku: `BAJ-${sufijo}`, stockMinimo: 5 });
      const alto = await crearItem({ sku: `ALT-${sufijo}`, stockMinimo: 1 });
      await entrar(bajo.id, 3);
      await entrar(alto.id, 20);
      const r = await comoAdmin(http().get('/inventario/alertas')).expect(200);
      const ids = r.body.map((i: { id: string }) => i.id);
      expect(ids).toContain(bajo.id);
      expect(ids).not.toContain(alto.id);
    });
  });

  describe('concurrencia: el stock nunca queda negativo', () => {
    it('dos salidas simultaneas del ultimo repuesto: una sola gana', async () => {
      const item = await crearItem({ sku: `CONC1-${sufijo}` });
      await entrar(item.id, 1);

      const salida = () =>
        comoAdmin(http().post('/inventario/movimientos')).send({
          itemId: item.id,
          tipo: 'salida',
          cantidad: 1,
        });
      const [r1, r2] = await Promise.all([salida(), salida()]);
      const estados = [r1.status, r2.status].sort();
      expect(estados).toEqual([201, 409]);
      expect(await stockDe(item.id)).toBe(0);
    });

    it('10 salidas a la vez con stock para 5: exactamente 5 ganan', async () => {
      const item = await crearItem({ sku: `CONC2-${sufijo}` });
      await entrar(item.id, 5);

      const salida = () =>
        comoAdmin(http().post('/inventario/movimientos')).send({
          itemId: item.id,
          tipo: 'salida',
          cantidad: 1,
        });
      const resultados = await Promise.all(Array.from({ length: 10 }, salida));
      const aprobados = resultados.filter((r) => r.status === 201).length;
      const rechazados = resultados.filter((r) => r.status === 409).length;
      expect(aprobados).toBe(5);
      expect(rechazados).toBe(5);
      expect(await stockDe(item.id)).toBe(0);
    });

    it('una entrada y una salida a la vez tambien se serializan (sin perder ninguna)', async () => {
      const item = await crearItem({ sku: `CONC3-${sufijo}` });
      await entrar(item.id, 1);

      const [rEntrada, rSalida] = await Promise.all([
        comoAdmin(http().post('/inventario/movimientos')).send({
          itemId: item.id,
          tipo: 'entrada',
          cantidad: 2,
          costoUnitarioCentavos: 1000,
          proveedor: 'P',
          facturaProveedor: 'F',
        }),
        comoAdmin(http().post('/inventario/movimientos')).send({
          itemId: item.id,
          tipo: 'salida',
          cantidad: 1,
        }),
      ]);
      expect(rEntrada.status).toBe(201);
      expect(rSalida.status).toBe(201);
      // 1 (inicial) + 2 (entrada) - 1 (salida) = 2, sin importar el orden.
      expect(await stockDe(item.id)).toBe(2);
    });
  });

  // ------------------------------------------------------------- helpers

  async function entrar(
    itemId: string,
    cantidad: number,
    factura = 'F',
    costo = 1_000_000,
  ) {
    await comoAdmin(http().post('/inventario/movimientos'))
      .send({
        itemId,
        tipo: 'entrada',
        cantidad,
        costoUnitarioCentavos: costo,
        proveedor: 'Proveedor de prueba',
        facturaProveedor: factura,
      })
      .expect(201);
  }

  async function venderDeMostrador(itemId: string, cantidad: number) {
    await comoAdmin(http().post('/inventario/movimientos'))
      .send({
        itemId,
        tipo: 'salida',
        cantidad,
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
});
