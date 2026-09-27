import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Inject,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ContextoDb } from '@turnos-platform/tenant';
import { porcentajeRedondeado, type TarifaIva } from '../../common/precios.util';
import { buscarUsuario } from '../../common/tecnicos.util';
import { InventarioService } from '../inventario/inventario.service';
import type { NotificationProvider } from '../notifications/providers/notification-provider.interface';
import { EMAIL_PROVIDER } from '../notifications/providers/provider.tokens';
import { PoliticaService } from '../politica/politica.service';
import { ServiciosService } from '../servicios/servicios.service';
import {
  AgregarLineaRepuestoDto,
  AgregarLineaServicioDto,
  ActualizarLineaDto,
  AnularOrdenDto,
  CrearOrdenDto,
  EstadoOrdenVenta,
  MarcarPagadaDto,
  OrdenesQueryDto,
} from './dto/ventas.dto';
import {
  calcularLinea,
  calcularTotalesOrden,
  descuentoDentroDelTope,
  textoCotizacion,
  type LineaCalculada,
  type TotalesOrden,
} from './orden-venta.util';

interface Usuario {
  sub: string;
  rol: string;
}

interface FilaOrden {
  id: string;
  numero: number;
  tallerId: string;
  turnoId: string | null;
  usuarioId: string | null;
  clienteNombre: string | null;
  clienteEmail: string | null;
  estado: EstadoOrdenVenta;
  subtotalCentavos: string | null;
  descuentoCentavos: string | null;
  ivaCentavos: string | null;
  totalCentavos: string | null;
  anticipoCentavos: string | null;
  saldoCentavos: string | null;
  responsableIva: boolean | null;
  creadoPor: string;
  creadoPorNombre: string | null;
  creadoEn: Date;
  confirmadaEn: Date | null;
  confirmadaPor: string | null;
  confirmadaPorNombre: string | null;
  pagadaEn: Date | null;
  pagadaPor: string | null;
  pagadaPorNombre: string | null;
  medioPago: string | null;
  comprobantePago: string | null;
  anuladaEn: Date | null;
  anuladaPor: string | null;
  anuladaPorNombre: string | null;
  motivoAnulacion: string | null;
  cotizacionEnviadaEn: Date | null;
  cotizacionAceptadaEn: Date | null;
}

interface FilaLinea {
  id: string;
  tipo: 'servicio' | 'repuesto';
  servicioId: string | null;
  itemId: string | null;
  descripcion: string;
  cantidad: string;
  precioUnitarioCentavos: string;
  tarifaIva: TarifaIva;
  descuentoPorcentaje: number;
  descuentoAplicadoPor: string | null;
  descuentoAplicadoPorNombre: string | null;
  creadoEn: Date;
}

export interface LineaOrdenVenta extends LineaCalculada {
  id: string;
  tipo: 'servicio' | 'repuesto';
  servicioId: string | null;
  itemId: string | null;
  descripcion: string;
  cantidad: number;
  precioUnitarioCentavos: number;
  tarifaIva: TarifaIva;
  descuentoPorcentaje: number;
  descuentoAplicadoPor: string | null;
  descuentoAplicadoPorNombre: string | null;
}

export interface OrdenVenta {
  id: string;
  numero: number;
  turnoId: string | null;
  usuarioId: string | null;
  clienteNombre: string | null;
  clienteEmail: string | null;
  estado: EstadoOrdenVenta;
  lineas: LineaOrdenVenta[];
  totales: TotalesOrden;
  /** true: los totales son los congelados al confirmar, no un calculo al vuelo. */
  congelado: boolean;
  creadoPor: string;
  creadoPorNombre: string | null;
  creadoEn: string;
  confirmadaEn: string | null;
  confirmadaPorNombre: string | null;
  pagadaEn: string | null;
  pagadaPorNombre: string | null;
  medioPago: string | null;
  comprobantePago: string | null;
  anuladaEn: string | null;
  anuladaPorNombre: string | null;
  motivoAnulacion: string | null;
  cotizacionEnviadaEn: string | null;
  cotizacionAceptadaEn: string | null;
}

export interface ResumenOrdenVenta {
  id: string;
  numero: number;
  turnoId: string | null;
  clienteNombre: string | null;
  estado: EstadoOrdenVenta;
  /** null: borrador (no tiene total congelado; abrila para ver el calculo). */
  totalCentavos: number | null;
  creadoEn: string;
}

const SELECT_ORDEN = `
  SELECT o.id, o.numero, o.taller_id AS "tallerId", o.turno_id AS "turnoId",
         o.usuario_id AS "usuarioId", u.nombre AS "clienteNombre", u.email AS "clienteEmail",
         o.estado, o.subtotal_centavos AS "subtotalCentavos",
         o.descuento_centavos AS "descuentoCentavos", o.iva_centavos AS "ivaCentavos",
         o.total_centavos AS "totalCentavos", o.anticipo_centavos AS "anticipoCentavos",
         o.saldo_centavos AS "saldoCentavos", o.responsable_iva AS "responsableIva",
         o.creado_por AS "creadoPor", cp.nombre AS "creadoPorNombre", o.creado_en AS "creadoEn",
         o.confirmada_en AS "confirmadaEn", o.confirmada_por AS "confirmadaPor",
         fp.nombre AS "confirmadaPorNombre",
         o.pagada_en AS "pagadaEn", o.pagada_por AS "pagadaPor", pp.nombre AS "pagadaPorNombre",
         o.medio_pago AS "medioPago", o.comprobante_pago AS "comprobantePago",
         o.anulada_en AS "anuladaEn", o.anulada_por AS "anuladaPor", ap.nombre AS "anuladaPorNombre",
         o.motivo_anulacion AS "motivoAnulacion",
         o.cotizacion_enviada_en AS "cotizacionEnviadaEn", o.cotizacion_aceptada_en AS "cotizacionAceptadaEn"
    FROM ordenes_venta o
    LEFT JOIN usuarios u  ON u.id = o.usuario_id
    LEFT JOIN usuarios cp ON cp.id = o.creado_por
    LEFT JOIN usuarios fp ON fp.id = o.confirmada_por
    LEFT JOIN usuarios pp ON pp.id = o.pagada_por
    LEFT JOIN usuarios ap ON ap.id = o.anulada_por`;

const SELECT_LINEA = `
  SELECT l.id, l.tipo, l.servicio_id AS "servicioId", l.item_id AS "itemId",
         l.descripcion, l.cantidad, l.precio_unitario_centavos AS "precioUnitarioCentavos",
         l.tarifa_iva AS "tarifaIva", l.descuento_porcentaje AS "descuentoPorcentaje",
         l.descuento_aplicado_por AS "descuentoAplicadoPor", du.nombre AS "descuentoAplicadoPorNombre",
         l.creado_en AS "creadoEn"
    FROM ordenes_venta_lineas l
    LEFT JOIN usuarios du ON du.id = l.descuento_aplicado_por
   WHERE l.orden_id = $1
   ORDER BY l.creado_en`;

/** Lo ya pagado de un turno (Sprint 24): igual que en pagos.service.ts. */
const SQL_PAGADO_TURNO = `
  SELECT coalesce(sum(p.monto_centavos), 0)::bigint AS pagado
    FROM pagos p
   WHERE p.turno_id = $1 AND p.estado IN ('aprobado', 'en_disputa')
     AND NOT p.duplicado
     AND NOT EXISTS (SELECT 1 FROM reembolsos r WHERE r.pago_id = p.id)`;

const num = (v: string | number | null): number | null =>
  v === null ? null : Number(v);

/**
 * Orden de venta (Sprint 26): el documento de cobro de un turno (su
 * servicio, con el precio guardado, mas los repuestos que se le cargaron) o
 * de una venta de mostrador. Vive en borrador mientras se arma -- ahi los
 * totales se calculan al vuelo desde las lineas vigentes -- y se congela
 * al confirmar (mismo criterio que el precio guardado del turno, Sprint
 * 21): un cambio de precio o de configuracion fiscal despues no altera una
 * orden ya confirmada.
 */
@Injectable()
export class VentasService {
  private readonly logger = new Logger(VentasService.name);

  constructor(
    private readonly db: ContextoDb,
    private readonly inventario: InventarioService,
    private readonly servicios: ServiciosService,
    private readonly politica: PoliticaService,
    @Inject(EMAIL_PROVIDER) private readonly email: NotificationProvider,
  ) {}

  // ------------------------------------------------------------- listar

  async listar(query: OrdenesQueryDto): Promise<ResumenOrdenVenta[]> {
    const taller = this.db.exigirTaller();
    const filas = (await this.db.query(
      `SELECT o.id, o.numero, o.turno_id AS "turnoId", u.nombre AS "clienteNombre",
              o.estado, o.total_centavos AS "totalCentavos", o.creado_en AS "creadoEn"
         FROM ordenes_venta o
         LEFT JOIN usuarios u ON u.id = o.usuario_id
        WHERE o.taller_id = $1
          AND ($2::text IS NULL OR o.estado = $2)
          AND ($3::uuid IS NULL OR o.turno_id = $3)
        ORDER BY o.creado_en DESC
        LIMIT 200`,
      [taller, query.estado ?? null, query.turnoId ?? null],
    )) as (Omit<ResumenOrdenVenta, 'totalCentavos' | 'creadoEn'> & {
      totalCentavos: string | null;
      creadoEn: Date;
    })[];
    return filas.map((f) => ({
      ...f,
      totalCentavos: num(f.totalCentavos),
      creadoEn: f.creadoEn.toISOString(),
    }));
  }

  async obtener(id: string): Promise<OrdenVenta> {
    const orden = await this.ordenCruda(id);
    const lineas = await this.lineasCrudas(id);
    return this.presentar(orden, lineas);
  }

  // -------------------------------------------------------------- crear

  async crear(dto: CrearOrdenDto, usuario: Usuario): Promise<OrdenVenta> {
    const taller = this.db.exigirTaller();
    let turno: { id: string; usuarioId: string | null; servicioId: string | null } | null = null;
    if (dto.turnoId) {
      const [fila] = (await this.db.query(
        `SELECT t.id, t.usuario_id AS "usuarioId", t.servicio_id AS "servicioId",
                t.taller_id AS "tallerId"
           FROM turnos t WHERE t.id = $1`,
        [dto.turnoId],
      )) as { id: string; usuarioId: string | null; servicioId: string | null; tallerId: string }[];
      if (!fila || fila.tallerId !== taller) {
        throw new NotFoundException(`Turno ${dto.turnoId} no encontrado`);
      }
      turno = fila;
    }
    // Una venta de mostrador con cliente elegido a mano: tiene que ser un
    // cliente que este taller pueda ver (RLS: el suyo o relacionado por
    // clientes_taller), no cualquier id de usuarios de otro taller.
    if (dto.usuarioId && !turno) {
      const cliente = await buscarUsuario(this.db.ejecutor(), dto.usuarioId);
      if (!cliente || cliente.rol !== 'cliente') {
        throw new NotFoundException(`Cliente ${dto.usuarioId} no encontrado`);
      }
    }
    const usuarioId = dto.usuarioId ?? turno?.usuarioId ?? null;

    await this.db.query(
      `SELECT pg_advisory_xact_lock(hashtext('ordenes_venta:' || $1::text))`,
      [taller],
    );
    const [{ id }] = (await this.db.query(
      `INSERT INTO ordenes_venta (taller_id, numero, turno_id, usuario_id, creado_por)
       SELECT $1, coalesce(max(numero), 0) + 1, $2, $3, $4
         FROM ordenes_venta WHERE taller_id = $1
       RETURNING id`,
      [taller, dto.turnoId ?? null, usuarioId, usuario.sub],
    )) as { id: string }[];

    if (turno?.servicioId) {
      await this.agregarLineaDesdeTurno(id, dto.turnoId!, turno.servicioId);
    }
    return this.obtener(id);
  }

  /** El servicio con el precio con el que se reservo el turno, no el actual. */
  private async agregarLineaDesdeTurno(
    ordenId: string,
    turnoId: string,
    servicioId: string,
  ): Promise<void> {
    const [fila] = (await this.db.query(
      `SELECT s.nombre, t.precio_base_centavos AS "precioBaseCentavos",
              t.tarifa_iva AS "tarifaIva"
         FROM turnos t JOIN servicios s ON s.id = t.servicio_id
        WHERE t.id = $1`,
      [turnoId],
    )) as { nombre: string; precioBaseCentavos: string | null; tarifaIva: number | null }[];
    // Turno sin precio guardado (anterior al Sprint 21, rarisimo): sin
    // linea automatica, el admin la agrega a mano si hace falta.
    if (!fila || fila.precioBaseCentavos === null || fila.tarifaIva === null) return;
    await this.db.query(
      `INSERT INTO ordenes_venta_lineas
         (orden_id, tipo, servicio_id, descripcion, cantidad, precio_unitario_centavos, tarifa_iva)
       VALUES ($1, 'servicio', $2, $3, 1, $4, $5)`,
      [ordenId, servicioId, fila.nombre, fila.precioBaseCentavos, fila.tarifaIva],
    );
  }

  // --------------------------------------------------------------- lineas

  async agregarLineaServicio(
    ordenId: string,
    dto: AgregarLineaServicioDto,
  ): Promise<OrdenVenta> {
    await this.exigirBorrador(ordenId);
    const servicio = await this.servicios.findOne(dto.servicioId);
    await this.db.query(
      `INSERT INTO ordenes_venta_lineas
         (orden_id, tipo, servicio_id, descripcion, cantidad, precio_unitario_centavos, tarifa_iva)
       VALUES ($1, 'servicio', $2, $3, $4, $5, $6)`,
      [
        ordenId,
        servicio.id,
        servicio.nombre,
        dto.cantidad ?? 1,
        servicio.precioBaseCentavos,
        servicio.tarifaIva,
      ],
    );
    return this.obtener(ordenId);
  }

  async agregarLineaRepuesto(
    ordenId: string,
    dto: AgregarLineaRepuestoDto,
    usuario: Usuario,
  ): Promise<OrdenVenta> {
    await this.exigirBorrador(ordenId);
    const item = await this.inventario.obtener(dto.itemId);
    const descuentoPorcentaje = dto.descuentoPorcentaje ?? 0;
    await this.validarTope(descuentoPorcentaje);
    // El descuento se calcula y se GUARDA en centavos (sobre la base, sin
    // IVA): no depende de si el taller cobra IVA, asi que no hace falta
    // saber eso todavia para esta cuenta.
    const descuentoCentavos = porcentajeRedondeado(
      Math.round(item.precioBaseCentavos * dto.cantidad),
      descuentoPorcentaje,
    );
    await this.db.query(
      `INSERT INTO ordenes_venta_lineas
         (orden_id, tipo, item_id, descripcion, cantidad, precio_unitario_centavos,
          tarifa_iva, descuento_porcentaje, descuento_centavos, descuento_aplicado_por)
       VALUES ($1, 'repuesto', $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        ordenId,
        item.id,
        item.nombre,
        dto.cantidad,
        item.precioBaseCentavos,
        item.tarifaIva,
        descuentoPorcentaje,
        descuentoCentavos,
        descuentoPorcentaje > 0 ? usuario.sub : null,
      ],
    );
    return this.obtener(ordenId);
  }

  async actualizarLinea(
    ordenId: string,
    lineaId: string,
    dto: ActualizarLineaDto,
    usuario: Usuario,
  ): Promise<OrdenVenta> {
    await this.exigirBorrador(ordenId);
    const [linea] = (await this.db.query(
      `SELECT precio_unitario_centavos AS "precioUnitarioCentavos", cantidad,
              descuento_porcentaje AS "descuentoPorcentaje"
         FROM ordenes_venta_lineas WHERE id = $1 AND orden_id = $2`,
      [lineaId, ordenId],
    )) as { precioUnitarioCentavos: string; cantidad: string; descuentoPorcentaje: number }[];
    if (!linea) throw new NotFoundException(`Linea ${lineaId} no encontrada`);

    const cantidad = dto.cantidad ?? Number(linea.cantidad);
    const descuentoPorcentaje = dto.descuentoPorcentaje ?? linea.descuentoPorcentaje;
    if (dto.descuentoPorcentaje !== undefined) await this.validarTope(descuentoPorcentaje);
    const descuentoCentavos = porcentajeRedondeado(
      Math.round(Number(linea.precioUnitarioCentavos) * cantidad),
      descuentoPorcentaje,
    );
    await this.db.query(
      `UPDATE ordenes_venta_lineas
          SET cantidad = $3, descuento_porcentaje = $4, descuento_centavos = $5,
              descuento_aplicado_por = $6
        WHERE id = $1 AND orden_id = $2`,
      [
        lineaId,
        ordenId,
        cantidad,
        descuentoPorcentaje,
        descuentoCentavos,
        descuentoPorcentaje > 0 ? usuario.sub : null,
      ],
    );
    return this.obtener(ordenId);
  }

  async borrarLinea(ordenId: string, lineaId: string): Promise<OrdenVenta> {
    await this.exigirBorrador(ordenId);
    const [fila] = (await this.db.query(
      `DELETE FROM ordenes_venta_lineas WHERE id = $1 AND orden_id = $2 RETURNING id`,
      [lineaId, ordenId],
    )) as { id: string }[];
    if (!fila) throw new NotFoundException(`Linea ${lineaId} no encontrada`);
    return this.obtener(ordenId);
  }

  private async validarTope(descuentoPorcentaje: number): Promise<void> {
    const { descuentoMaximoPorcentaje } = await this.politica.obtener();
    if (!descuentoDentroDelTope(descuentoPorcentaje, descuentoMaximoPorcentaje)) {
      throw new BadRequestException(
        `El descuento maximo de este taller es ${descuentoMaximoPorcentaje}%.`,
      );
    }
  }

  // -------------------------------------------------------- transiciones

  /**
   * borrador -> confirmada: congela los totales (con el anticipo del turno
   * de ese momento) y descuenta stock de cada linea de repuesto. Si algun
   * repuesto no tiene stock, no se confirma NADA (el error se propaga y el
   * request entero revierte -- ver InventarioService.registrarSalidaPorConfirmarVenta,
   * que usa su propio savepoint solo para poder informar cuanto queda, no
   * para dejar pasar el resto).
   */
  async confirmar(ordenId: string, usuario: Usuario): Promise<OrdenVenta> {
    const orden = await this.ordenCruda(ordenId, true);
    if (orden.estado !== 'borrador') {
      throw new ConflictException('Esta orden ya no esta en borrador.');
    }
    const lineas = await this.lineasCrudas(ordenId);
    if (lineas.length === 0) {
      throw new BadRequestException('Agrega al menos una linea antes de confirmar.');
    }
    if (orden.cotizacionEnviadaEn && !orden.cotizacionAceptadaEn) {
      throw new ConflictException(
        'Se le envio una cotizacion al cliente: hay que esperar a que la acepte antes de confirmar.',
      );
    }

    const responsableIva = await this.servicios.responsableIva();
    const calculadas = lineas.map((l) => this.calcularLineaCruda(l, responsableIva));
    const anticipoCentavos = orden.turnoId
      ? await this.anticipoDelTurno(orden.turnoId)
      : 0;
    const totales = calcularTotalesOrden(calculadas, anticipoCentavos);

    for (const linea of lineas) {
      if (linea.tipo !== 'repuesto' || !linea.itemId) continue;
      await this.inventario.registrarSalidaPorConfirmarVenta({
        itemId: linea.itemId,
        cantidad: Number(linea.cantidad),
        ordenVentaId: ordenId,
        turnoId: orden.turnoId,
        usuarioId: usuario.sub,
      });
    }

    await this.db.query(
      `UPDATE ordenes_venta
          SET estado = 'confirmada', confirmada_en = now(), confirmada_por = $2,
              subtotal_centavos = $3, descuento_centavos = $4, iva_centavos = $5,
              total_centavos = $6, anticipo_centavos = $7, saldo_centavos = $8,
              responsable_iva = $9, actualizado_en = now()
        WHERE id = $1`,
      [
        ordenId,
        usuario.sub,
        totales.subtotalCentavos,
        totales.descuentoCentavos,
        totales.ivaCentavos,
        totales.totalCentavos,
        totales.anticipoCentavos,
        totales.saldoCentavos,
        responsableIva,
      ],
    );
    return this.obtener(ordenId);
  }

  async marcarPagada(ordenId: string, dto: MarcarPagadaDto, usuario: Usuario): Promise<OrdenVenta> {
    const orden = await this.ordenCruda(ordenId, true);
    if (orden.estado !== 'confirmada') {
      throw new ConflictException(
        orden.estado === 'borrador'
          ? 'Primero hay que confirmar la orden.'
          : `Esta orden ya esta ${orden.estado}.`,
      );
    }
    await this.db.query(
      `UPDATE ordenes_venta
          SET estado = 'pagada', pagada_en = now(), pagada_por = $2,
              medio_pago = $3, comprobante_pago = $4, actualizado_en = now()
        WHERE id = $1`,
      [ordenId, usuario.sub, dto.medioPago, dto.comprobante?.trim() || null],
    );
    return this.obtener(ordenId);
  }

  /** Anula y devuelve el stock de cada linea de repuesto (nunca corrige el movimiento original). */
  async anular(ordenId: string, dto: AnularOrdenDto, usuario: Usuario): Promise<OrdenVenta> {
    const orden = await this.ordenCruda(ordenId, true);
    if (orden.estado !== 'confirmada' && orden.estado !== 'pagada') {
      throw new ConflictException(
        orden.estado === 'borrador'
          ? 'Un borrador se borra, no se anula.'
          : 'Esta orden ya esta anulada.',
      );
    }
    const lineas = await this.lineasCrudas(ordenId);
    for (const linea of lineas) {
      if (linea.tipo !== 'repuesto' || !linea.itemId) continue;
      await this.inventario.registrarDevolucionPorAnularVenta({
        itemId: linea.itemId,
        cantidad: Number(linea.cantidad),
        ordenVentaId: ordenId,
        usuarioId: usuario.sub,
      });
    }
    await this.db.query(
      `UPDATE ordenes_venta
          SET estado = 'anulada', anulada_en = now(), anulada_por = $2,
              motivo_anulacion = $3, actualizado_en = now()
        WHERE id = $1`,
      [ordenId, usuario.sub, dto.motivo.trim()],
    );
    return this.obtener(ordenId);
  }

  /** Descarta un borrador (nunca toco stock ni cobros: se borra sin mas tramite). */
  async borrar(ordenId: string): Promise<void> {
    const orden = await this.ordenCruda(ordenId);
    if (orden.estado !== 'borrador') {
      throw new ConflictException('Solo se puede borrar una orden en borrador.');
    }
    await this.db.query('DELETE FROM ordenes_venta WHERE id = $1', [ordenId]);
  }

  // ----------------------------------------------------------- cotizacion

  async enviarCotizacion(ordenId: string): Promise<{ enviado: boolean }> {
    const orden = await this.ordenCruda(ordenId);
    if (orden.estado !== 'borrador') {
      throw new ConflictException('Solo se cotiza una orden en borrador.');
    }
    if (!orden.clienteEmail) {
      throw new BadRequestException(
        'Esta orden no tiene un cliente con correo: elegi uno antes de enviar la cotizacion.',
      );
    }
    const lineas = await this.lineasCrudas(ordenId);
    const responsableIva = await this.servicios.responsableIva();
    const calculadas = lineas.map((l) => this.calcularLineaCruda(l, responsableIva));
    const anticipoCentavos = orden.turnoId ? await this.anticipoDelTurno(orden.turnoId) : 0;
    const totales = calcularTotalesOrden(calculadas, anticipoCentavos);
    const base = (process.env.WEB_URL ?? 'http://localhost:5173').replace(/\/$/, '');

    const { asunto, mensaje } = textoCotizacion({
      tallerNombre: (await this.datosTaller(orden.tallerId)).nombre,
      numero: orden.numero,
      clienteNombre: orden.clienteNombre ?? 'cliente',
      lineas: lineas.map((l, i) => ({
        descripcion: l.descripcion,
        cantidad: Number(l.cantidad),
        totalCentavos: calculadas[i].totalCentavos,
      })),
      totales,
      enlace: `${base}/ventas/${ordenId}`,
    });

    let enviado = false;
    try {
      await this.email.enviar({ destinatario: orden.clienteEmail, asunto, mensaje });
      enviado = true;
    } catch (error) {
      // No se cae el request por un correo: la cotizacion queda marcada
      // como enviada igual (el admin puede reenviarla si hace falta) y el
      // fallo queda en el log, igual que el resto de los envios de este
      // servicio (ValidadorProveedores, CorreosService).
      this.logger.error(
        `No se pudo enviar la cotizacion de la orden ${ordenId}: ${(error as Error).message}`,
      );
    }
    await this.db.query(
      `UPDATE ordenes_venta SET cotizacion_enviada_en = now() WHERE id = $1`,
      [ordenId],
    );
    return { enviado };
  }

  async aceptarCotizacion(ordenId: string): Promise<OrdenVenta> {
    const [fila] = (await this.db.query('SELECT * FROM aceptar_cotizacion_venta($1)', [
      ordenId,
    ])) as unknown[];
    if (!fila) {
      throw new NotFoundException(
        'No se encontro una cotizacion tuya, pendiente de aceptar, con ese id.',
      );
    }
    return this.obtener(ordenId);
  }

  // ------------------------------------------------------------ privados

  private async ordenCruda(id: string, forUpdate = false): Promise<FilaOrden> {
    const [fila] = (await this.db.query(
      `${SELECT_ORDEN} WHERE o.id = $1${forUpdate ? ' FOR UPDATE OF o' : ''}`,
      [id],
    )) as FilaOrden[];
    if (!fila) throw new NotFoundException(`Orden de venta ${id} no encontrada`);
    return fila;
  }

  private lineasCrudas(ordenId: string): Promise<FilaLinea[]> {
    return this.db.query<FilaLinea[]>(SELECT_LINEA, [ordenId]);
  }

  private async exigirBorrador(ordenId: string): Promise<void> {
    const orden = await this.ordenCruda(ordenId);
    if (orden.estado !== 'borrador') {
      throw new ConflictException(
        'Esta orden ya no esta en borrador: sus lineas no se modifican.',
      );
    }
  }

  private calcularLineaCruda(linea: FilaLinea, responsableIva: boolean): LineaCalculada {
    return calcularLinea(
      {
        precioUnitarioCentavos: Number(linea.precioUnitarioCentavos),
        cantidad: Number(linea.cantidad),
        tarifaIva: linea.tarifaIva,
        descuentoPorcentaje: linea.descuentoPorcentaje,
      },
      responsableIva,
    );
  }

  private async anticipoDelTurno(turnoId: string): Promise<number> {
    const [{ pagado }] = (await this.db.query(SQL_PAGADO_TURNO, [turnoId])) as {
      pagado: string;
    }[];
    return Number(pagado);
  }

  private async datosTaller(tallerId: string): Promise<{ nombre: string }> {
    const [fila] = (await this.db.query('SELECT nombre FROM talleres WHERE id = $1', [
      tallerId,
    ])) as { nombre: string }[];
    return fila;
  }

  /** Arma la respuesta: totales en vivo si borrador, congelados si no. */
  private async presentar(orden: FilaOrden, lineasCrudas: FilaLinea[]): Promise<OrdenVenta> {
    const congelado = orden.estado !== 'borrador';
    // responsableIva "congelado" cuando existe (desde confirmada); en
    // borrador, el actual (para que la vista previa refleje la
    // configuracion vigente, que es la que se va a usar SI se confirma
    // ahora mismo).
    const responsableIva = congelado
      ? (orden.responsableIva ?? false)
      : await this.servicios.responsableIva();
    const calculadas = lineasCrudas.map((l) => this.calcularLineaCruda(l, responsableIva));
    const lineas: LineaOrdenVenta[] = lineasCrudas.map((l, i) => ({
      ...calculadas[i],
      id: l.id,
      tipo: l.tipo,
      servicioId: l.servicioId,
      itemId: l.itemId,
      descripcion: l.descripcion,
      cantidad: Number(l.cantidad),
      precioUnitarioCentavos: Number(l.precioUnitarioCentavos),
      tarifaIva: l.tarifaIva,
      descuentoPorcentaje: l.descuentoPorcentaje,
      descuentoAplicadoPor: l.descuentoAplicadoPor,
      descuentoAplicadoPorNombre: l.descuentoAplicadoPorNombre,
    }));

    let totales: TotalesOrden;
    if (congelado) {
      totales = {
        subtotalCentavos: Number(orden.subtotalCentavos),
        descuentoCentavos: Number(orden.descuentoCentavos),
        ivaCentavos: Number(orden.ivaCentavos),
        totalCentavos: Number(orden.totalCentavos),
        anticipoCentavos: Number(orden.anticipoCentavos),
        saldoCentavos: Number(orden.saldoCentavos),
      };
    } else {
      const anticipoCentavos = orden.turnoId ? await this.anticipoDelTurno(orden.turnoId) : 0;
      totales = calcularTotalesOrden(calculadas, anticipoCentavos);
    }

    return {
      id: orden.id,
      numero: orden.numero,
      turnoId: orden.turnoId,
      usuarioId: orden.usuarioId,
      clienteNombre: orden.clienteNombre,
      clienteEmail: orden.clienteEmail,
      estado: orden.estado,
      lineas,
      totales,
      congelado,
      creadoPor: orden.creadoPor,
      creadoPorNombre: orden.creadoPorNombre,
      creadoEn: orden.creadoEn.toISOString(),
      confirmadaEn: orden.confirmadaEn?.toISOString() ?? null,
      confirmadaPorNombre: orden.confirmadaPorNombre,
      pagadaEn: orden.pagadaEn?.toISOString() ?? null,
      pagadaPorNombre: orden.pagadaPorNombre,
      medioPago: orden.medioPago,
      comprobantePago: orden.comprobantePago,
      anuladaEn: orden.anuladaEn?.toISOString() ?? null,
      anuladaPorNombre: orden.anuladaPorNombre,
      motivoAnulacion: orden.motivoAnulacion,
      cotizacionEnviadaEn: orden.cotizacionEnviadaEn?.toISOString() ?? null,
      cotizacionAceptadaEn: orden.cotizacionAceptadaEn?.toISOString() ?? null,
    };
  }
}
