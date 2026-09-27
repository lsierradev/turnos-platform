import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContextoDb } from '@turnos-platform/tenant';
import { calcularPrecio, type Precio } from '../../common/precios.util';
import { ServiciosService } from '../servicios/servicios.service';
import {
  ActualizarItemDto,
  CrearItemDto,
  RegistrarMovimientoDto,
} from './dto/inventario.dto';
import { calcularCantidadConSigno } from './movimiento.util';

export interface ItemInventario {
  id: string;
  sku: string;
  nombre: string;
  marca: string | null;
  unidad: string;
  costoCentavos: number;
  precioBaseCentavos: number;
  tarifaIva: number;
  stockMinimo: number;
  activo: boolean;
  creadoEn: Date;
  actualizadoEn: Date;
}

/** El item con el stock (suma del kardex), el precio con IVA y el valor. */
export type ItemConStock = ItemInventario & {
  stock: number;
  precio: Precio;
  /** stock * costoCentavos, redondeado. */
  valorCentavos: number;
};

export interface MovimientoInventario {
  id: string;
  itemId: string;
  itemNombre: string;
  itemUnidad: string;
  tipo: string;
  cantidad: number;
  costoUnitarioCentavos: number | null;
  proveedor: string | null;
  facturaProveedor: string | null;
  turnoId: string | null;
  motivo: string | null;
  creadoPor: string | null;
  creadoPorNombre: string | null;
  creadoEn: Date;
}

interface Usuario {
  sub: string;
  rol: string;
}

// Mismo tope que en el DTO (movimientos por encima de esto casi seguro son
// un error de tipeo, no un pedido real).
const CANTIDAD_MAXIMA = 1_000_000;

const SELECT_ITEM = `
  SELECT i.id, i.sku, i.nombre, i.marca, i.unidad,
         i.costo_centavos AS "costoCentavos",
         i.precio_base_centavos AS "precioBaseCentavos",
         i.tarifa_iva AS "tarifaIva", i.stock_minimo AS "stockMinimo",
         i.activo, i.creado_en AS "creadoEn", i.actualizado_en AS "actualizadoEn"
    FROM items_inventario i`;

/** El stock de UN item: la suma con signo de todo su kardex. */
const SQL_STOCK_ITEM =
  'coalesce((SELECT sum(m.cantidad) FROM movimientos_inventario m WHERE m.item_id = i.id), 0)';

@Injectable()
export class InventarioService {
  constructor(
    private readonly db: ContextoDb,
    private readonly servicios: ServiciosService,
  ) {}

  private num(v: string | number): number {
    return Number(v);
  }

  private presentar(
    fila: ItemInventario & { stock: string },
    responsableIva: boolean,
  ): ItemConStock {
    const stock = this.num(fila.stock);
    const precio = calcularPrecio(
      fila.precioBaseCentavos,
      fila.tarifaIva as 0 | 5 | 19,
      responsableIva,
    );
    return {
      ...fila,
      stock,
      costoCentavos: this.num(fila.costoCentavos),
      precioBaseCentavos: this.num(fila.precioBaseCentavos),
      stockMinimo: this.num(fila.stockMinimo),
      precio,
      // Redondeado al centavo: stock es NUMERIC(12,3), costo BIGINT.
      valorCentavos: Math.round(stock * this.num(fila.costoCentavos)),
    };
  }

  // ------------------------------------------------------------ catalogo

  async listar(soloActivos = true): Promise<ItemConStock[]> {
    const responsableIva = await this.servicios.responsableIva();
    const filas = (await this.db.query(
      `${SELECT_ITEM}, ${SQL_STOCK_ITEM} AS stock
        WHERE i.taller_id = $1 AND ($2::boolean = false OR i.activo)
        ORDER BY i.nombre`,
      [this.db.exigirTaller(), soloActivos],
    )) as (ItemInventario & { stock: string })[];
    return filas.map((f) => this.presentar(f, responsableIva));
  }

  private async item(id: string): Promise<ItemInventario & { stock: string }> {
    const [fila] = (await this.db.query(
      `${SELECT_ITEM}, ${SQL_STOCK_ITEM} AS stock WHERE i.id = $1`,
      [id],
    )) as (ItemInventario & { stock: string })[];
    if (!fila) throw new NotFoundException(`Repuesto ${id} no encontrado`);
    return fila;
  }

  async obtener(id: string): Promise<ItemConStock> {
    const fila = await this.item(id);
    return this.presentar(fila, await this.servicios.responsableIva());
  }

  async crear(dto: CrearItemDto): Promise<ItemConStock> {
    const taller = this.db.exigirTaller();
    try {
      const [fila] = (await this.db.query(
        `INSERT INTO items_inventario
           (taller_id, sku, nombre, marca, unidad, precio_base_centavos, tarifa_iva, stock_minimo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          taller,
          dto.sku.trim(),
          dto.nombre.trim(),
          dto.marca?.trim() || null,
          dto.unidad?.trim() || 'unidad',
          dto.precioBaseCentavos,
          dto.tarifaIva ?? 19,
          dto.stockMinimo ?? 0,
        ],
      )) as { id: string }[];
      return this.obtener(fila.id);
    } catch (error) {
      if (this.codigoError(error) === '23505') {
        throw new ConflictException(
          `Ya existe un repuesto con el codigo ${dto.sku.trim()}.`,
        );
      }
      throw error;
    }
  }

  async actualizar(id: string, dto: ActualizarItemDto): Promise<ItemConStock> {
    // Confirma que existe (y que RLS lo deja ver) antes de armar el UPDATE:
    // un id de otro taller da 404, no un UPDATE que no cambia nada.
    await this.item(id);
    const campos: string[] = [];
    const valores: unknown[] = [id];
    const set = (columna: string, valor: unknown) => {
      valores.push(valor);
      campos.push(`${columna} = $${valores.length}`);
    };
    if (dto.nombre !== undefined) set('nombre', dto.nombre.trim());
    if (dto.marca !== undefined) set('marca', dto.marca?.trim() || null);
    if (dto.unidad !== undefined) set('unidad', dto.unidad.trim());
    if (dto.precioBaseCentavos !== undefined)
      set('precio_base_centavos', dto.precioBaseCentavos);
    if (dto.tarifaIva !== undefined) set('tarifa_iva', dto.tarifaIva);
    if (dto.stockMinimo !== undefined) set('stock_minimo', dto.stockMinimo);
    if (dto.activo !== undefined) set('activo', dto.activo);
    if (campos.length === 0) return this.obtener(id);

    const [fila] = (await this.db.query(
      `UPDATE items_inventario SET ${campos.join(', ')}, actualizado_en = now()
        WHERE id = $1 RETURNING id`,
      valores,
    )) as { id: string }[];
    if (!fila) throw new NotFoundException(`Repuesto ${id} no encontrado`);
    return this.obtener(id);
  }

  // ---------------------------------------------------------- movimientos

  /**
   * Registra un movimiento de kardex. El signo de la cantidad lo decide el
   * tipo (entrada y devolucion suman, salida resta, ajuste segun
   * `sentido`); el CHECK de la base (movimientos_inventario_signo) es la
   * ultima palabra si aca se calculara mal.
   *
   * Si el stock quedaria negativo, el trigger de la base lo rechaza
   * (protegido tambien con movimientos simultaneos del mismo item, ver
   * migracion 020); aca se traduce ese rechazo a un 409 legible.
   */
  async registrarMovimiento(
    dto: RegistrarMovimientoDto,
    usuario: Usuario,
  ): Promise<{ movimiento: MovimientoInventario; item: ItemConStock }> {
    const taller = this.db.exigirTaller();
    if (dto.cantidad <= 0 || dto.cantidad > CANTIDAD_MAXIMA) {
      throw new BadRequestException(
        `La cantidad debe ser mayor que 0 y hasta ${CANTIDAD_MAXIMA}.`,
      );
    }
    // 404, no 403: RLS ya oculta los items de otro taller.
    await this.item(dto.itemId);

    if (dto.turnoId)
      await this.exigirTurnoParaSalida(dto.turnoId, taller, usuario);
    // El tecnico solo puede registrar salidas por uso en un turno suyo (lo
    // exige ademas la politica de RLS de movimientos_inventario_crear):
    // sin turnoId aca ya no llega, pero el mensaje es mas claro asi.
    if (usuario.rol === 'tecnico' && (dto.tipo !== 'salida' || !dto.turnoId)) {
      throw new ForbiddenException(
        'Como tecnico, solo podes registrar repuestos usados en un turno tuyo.',
      );
    }

    const cantidadConSigno = calcularCantidadConSigno(
      dto.tipo,
      dto.cantidad,
      dto.sentido,
    );

    try {
      const [fila] = (await this.db.conSavepoint(() =>
        this.db.query(
          `INSERT INTO movimientos_inventario
             (taller_id, item_id, tipo, cantidad, costo_unitario_centavos,
              proveedor, factura_proveedor, turno_id, motivo, creado_por)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id`,
          [
            taller,
            dto.itemId,
            dto.tipo,
            cantidadConSigno,
            dto.tipo === 'entrada' ? dto.costoUnitarioCentavos : null,
            dto.tipo === 'entrada' ? dto.proveedor?.trim() : null,
            dto.tipo === 'entrada' ? dto.facturaProveedor?.trim() : null,
            dto.tipo === 'salida' ? (dto.turnoId ?? null) : null,
            dto.motivo?.trim().slice(0, 300) || null,
            usuario.sub,
          ],
        ),
      )) as { id: string }[];

      const [movimiento] = (await this.db.query(
        this.selectMovimiento('m.id = $1'),
        [fila.id],
      )) as MovimientoInventario[];
      return { movimiento, item: await this.obtener(dto.itemId) };
    } catch (error) {
      if (this.esStockInsuficiente(error)) {
        const item = await this.obtener(dto.itemId);
        throw new ConflictException(
          `Stock insuficiente: quedan ${item.stock} ${item.unidad} de ${item.nombre}.`,
        );
      }
      throw error;
    }
  }

  /**
   * Descuenta stock por una linea de repuesto de una orden de venta
   * confirmada (Sprint 26). `usuarioId` es quien confirma la orden, no
   * necesariamente quien la va a usar (a diferencia de una salida
   * registrada a mano, esta la dispara el servicio de ventas).
   */
  async registrarSalidaPorConfirmarVenta(args: {
    itemId: string;
    cantidad: number;
    ordenVentaId: string;
    turnoId: string | null;
    usuarioId: string;
  }): Promise<void> {
    const taller = this.db.exigirTaller();
    try {
      await this.db.conSavepoint(() =>
        this.db.query(
          `INSERT INTO movimientos_inventario
             (taller_id, item_id, tipo, cantidad, turno_id, orden_venta_id, creado_por)
           VALUES ($1, $2, 'salida', $3, $4, $5, $6)`,
          [
            taller,
            args.itemId,
            -args.cantidad,
            args.turnoId,
            args.ordenVentaId,
            args.usuarioId,
          ],
        ),
      );
    } catch (error) {
      if (this.esStockInsuficiente(error)) {
        const item = await this.obtener(args.itemId);
        throw new ConflictException(
          `Stock insuficiente para ${item.nombre}: quedan ${item.stock} ${item.unidad}.`,
        );
      }
      throw error;
    }
  }

  /** Devuelve el stock de una linea de repuesto al anular la orden que la descuento. */
  async registrarDevolucionPorAnularVenta(args: {
    itemId: string;
    cantidad: number;
    ordenVentaId: string;
    usuarioId: string;
  }): Promise<void> {
    const taller = this.db.exigirTaller();
    await this.db.query(
      `INSERT INTO movimientos_inventario
         (taller_id, item_id, tipo, cantidad, orden_venta_id, motivo, creado_por)
       VALUES ($1, $2, 'devolucion', $3, $4, $5, $6)`,
      [
        taller,
        args.itemId,
        args.cantidad,
        args.ordenVentaId,
        'Anulacion de la orden de venta',
        args.usuarioId,
      ],
    );
  }

  private esStockInsuficiente(error: unknown): boolean {
    const codigo = this.codigoError(error);
    return codigo === 'check_violation' || codigo === '23514';
  }

  /** El turno tiene que ser del taller y, si pide un tecnico, ser suyo. */
  private async exigirTurnoParaSalida(
    turnoId: string,
    taller: string,
    usuario: Usuario,
  ): Promise<void> {
    const [turno] = (await this.db.query(
      `SELECT taller_id AS "tallerId", tecnico_id AS "tecnicoId" FROM turnos WHERE id = $1`,
      [turnoId],
    )) as { tallerId: string; tecnicoId: string | null }[];
    if (!turno || turno.tallerId !== taller) {
      throw new NotFoundException(`Turno ${turnoId} no encontrado`);
    }
    if (usuario.rol === 'tecnico' && turno.tecnicoId !== usuario.sub) {
      throw new ForbiddenException('Ese turno no es tuyo.');
    }
  }

  private selectMovimiento(where: string): string {
    return `
      SELECT m.id, m.item_id AS "itemId", i.nombre AS "itemNombre",
             i.unidad AS "itemUnidad", m.tipo, m.cantidad,
             m.costo_unitario_centavos AS "costoUnitarioCentavos",
             m.proveedor, m.factura_proveedor AS "facturaProveedor",
             m.turno_id AS "turnoId", m.motivo, m.creado_por AS "creadoPor",
             u.nombre AS "creadoPorNombre", m.creado_en AS "creadoEn"
        FROM movimientos_inventario m
        JOIN items_inventario i ON i.id = m.item_id
        LEFT JOIN usuarios u ON u.id = m.creado_por
       WHERE ${where}`;
  }

  /** Kardex de un item: cada movimiento con el saldo despues de aplicarlo. */
  async kardex(
    itemId: string,
  ): Promise<(MovimientoInventario & { saldo: number })[]> {
    await this.item(itemId);
    const filas = (await this.db.query(
      `SELECT m.id, m.item_id AS "itemId", m.tipo, m.cantidad,
              m.costo_unitario_centavos AS "costoUnitarioCentavos",
              m.proveedor, m.factura_proveedor AS "facturaProveedor",
              m.turno_id AS "turnoId", m.motivo, m.creado_por AS "creadoPor",
              u.nombre AS "creadoPorNombre", m.creado_en AS "creadoEn",
              sum(m.cantidad) OVER (ORDER BY m.creado_en, m.id) AS saldo
         FROM movimientos_inventario m
         LEFT JOIN usuarios u ON u.id = m.creado_por
        WHERE m.item_id = $1
        ORDER BY m.creado_en, m.id`,
      [itemId],
    )) as (MovimientoInventario & { saldo: string })[];
    return filas.map((f) => ({
      ...f,
      cantidad: this.num(f.cantidad),
      saldo: this.num(f.saldo),
    }));
  }

  /** Repuestos usados en un turno (para la orden de trabajo). */
  async movimientosDeTurno(turnoId: string): Promise<MovimientoInventario[]> {
    const filas = (await this.db.query(
      `${this.selectMovimiento('m.turno_id = $1')} ORDER BY m.creado_en`,
      [turnoId],
    )) as MovimientoInventario[];
    return filas.map((f) => ({ ...f, cantidad: this.num(f.cantidad) }));
  }

  // ------------------------------------------------------------ reportes

  async valorizacion(): Promise<{
    items: ItemConStock[];
    totalCentavos: number;
  }> {
    const items = (await this.listar(false)).filter((i) => i.stock !== 0);
    return {
      items,
      totalCentavos: items.reduce((s, i) => s + i.valorCentavos, 0),
    };
  }

  async alertaStockBajo(): Promise<ItemConStock[]> {
    return (await this.listar(true)).filter((i) => i.stock <= i.stockMinimo);
  }

  private codigoError(error: unknown): string | undefined {
    const e = error as { code?: string; driverError?: { code?: string } };
    return e.code ?? e.driverError?.code;
  }
}
