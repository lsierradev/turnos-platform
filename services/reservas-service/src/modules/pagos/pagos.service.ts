import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ContextoDb } from '@turnos-platform/tenant';
import { randomUUID } from 'crypto';
import type { EntityManager } from 'typeorm';
import { exigirCondiciones } from '../../common/condiciones.util';
import {
  fechaEnZona,
  zonaHorariaNegocio,
} from '../../common/zona-horaria.util';
import { WompiCliente } from './wompi-cliente.service';
import {
  aplicaTransicion,
  EstadoPago,
  estadoDeWompi,
  eventoAutentico,
  EventoWompi,
  firmaIntegridad,
  nuevaReferencia,
  TransaccionWompi,
  urlCheckout,
} from './wompi.util';

export type Concepto = 'anticipo' | 'saldo';
export type MedioPresencial = 'efectivo' | 'datafono' | 'transferencia';
export type MotivoReembolso =
  | 'cancelacion_en_ventana'
  | 'cancelacion_taller'
  | 'turno_liberado'
  | 'pago_duplicado';
type TipoAlerta =
  | 'reversion'
  | 'contracargo'
  | 'anulacion_externa'
  | 'monto_inconsistente'
  | 'pago_duplicado'
  | 'pago_tardio'
  | 'reembolso_pendiente'
  | 'reembolso_fallido';

type Consultable = Pick<EntityManager, 'query'>;

interface FilaTurno {
  id: string;
  tallerId: string;
  usuarioId: string | null;
  estado: string;
  canceladoPor: string | null;
  reprogramadoA: string | null;
  inicio: Date;
  totalCentavos: string | null;
  anticipoCentavos: string | null;
  anticipoEstado: 'no_requiere' | 'pendiente' | 'pagado';
  anticipoVenceEn: Date | null;
}

interface FilaPago {
  id: string;
  tallerId: string;
  turnoId: string;
  usuarioId: string | null;
  concepto: Concepto;
  canal: string;
  montoCentavos: string;
  referencia: string | null;
  estado: EstadoPago;
  wompiTransaccionId: string | null;
  metodo: string | null;
  ultimoEventoEn: Date | null;
  duplicado: boolean;
}

export interface Checkout {
  url: string;
  referencia: string;
  montoCentavos: number;
  /** Hasta cuando se puede pagar (la reserva del anticipo). */
  venceEn: string | null;
}

export interface ResumenPagos {
  totalCentavos: number | null;
  anticipoCentavos: number | null;
  anticipoEstado: FilaTurno['anticipoEstado'];
  anticipoVenceEn: string | null;
  /** Aprobado, sin duplicados ni lo que esta devuelto o por devolver. */
  pagadoCentavos: number;
  saldoCentavos: number | null;
  cobraEnLinea: boolean;
}

const SELECT_TURNO = `
  SELECT t.id, t.taller_id AS "tallerId", t.usuario_id AS "usuarioId", t.estado,
         t.cancelado_por AS "canceladoPor", t.reprogramado_a AS "reprogramadoA",
         lower(t.rango_tiempo) AS inicio,
         t.total_centavos AS "totalCentavos", t.anticipo_centavos AS "anticipoCentavos",
         t.anticipo_estado AS "anticipoEstado", t.anticipo_vence_en AS "anticipoVenceEn"
    FROM turnos t`;

const SELECT_PAGO = `
  SELECT p.id, p.taller_id AS "tallerId", p.turno_id AS "turnoId",
         p.usuario_id AS "usuarioId", p.concepto, p.canal,
         p.monto_centavos AS "montoCentavos", p.referencia, p.estado,
         p.wompi_transaccion_id AS "wompiTransaccionId", p.metodo,
         p.ultimo_evento_en AS "ultimoEventoEn", p.duplicado
    FROM pagos p`;

/** Pagado neto de un turno: lo que cuenta para el anticipo y el saldo. */
const SQL_PAGADO = `
  SELECT coalesce(sum(p.monto_centavos), 0)::bigint AS pagado
    FROM pagos p
   WHERE p.turno_id = $1 AND p.estado IN ('aprobado', 'en_disputa')
     AND NOT p.duplicado
     AND NOT EXISTS (SELECT 1 FROM reembolsos r WHERE r.pago_id = p.id)`;

/** Un checkout que no se usa en este tiempo deja de conciliarse. */
const HORAS_CHECKOUT = 24;
/** Gracia para un pago que Wompi todavia procesa (PSE, Nequi). */
const MINUTOS_GRACIA_PENDIENTE = 30;

const num = (v: string | number | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

/**
 * Pagos (Sprint 24). El dinero se cobra con las llaves de Wompi DE CADA
 * TALLER y va a su cuenta: TurnoPro no lo recibe.
 *
 * Reglas que atraviesan todo:
 * - El monto sale siempre del turno en la base, nunca del navegador.
 * - Lo unico que confirma un pago es un evento de Wompi con firma valida o
 *   la consulta del backend a la API de Wompi (conciliacion). La
 *   redireccion del checkout no confirma nada.
 * - Procesar el mismo evento dos veces no paga dos veces (eventos_wompi +
 *   transiciones que nunca retroceden, ver aplicaTransicion).
 * - No hay datos de tarjeta en ningun lado: se paga en el checkout de
 *   Wompi y solo vuelven el id, el estado y el tipo de medio.
 */
@Injectable()
export class PagosService {
  private readonly logger = new Logger(PagosService.name);

  constructor(
    private readonly db: ContextoDb,
    private readonly wompi: WompiCliente,
  ) {}

  // ------------------------------------------------------------ resumen

  async resumen(turnoId: string): Promise<ResumenPagos> {
    const turno = await this.turnoVisible(turnoId);
    return this.calcularResumen(this.db.ejecutor(), turno);
  }

  async detalleTurno(turnoId: string) {
    const turno = await this.turnoVisible(turnoId);
    const q = this.db.ejecutor();
    const pagos = await q.query(
      `SELECT p.id, p.concepto, p.canal, p.monto_centavos::bigint AS "montoCentavos",
              p.estado, p.metodo, p.referencia, p.wompi_transaccion_id AS "transaccionId",
              p.comprobante, p.duplicado, p.aprobado_en AS "aprobadoEn",
              p.creado_en AS "creadoEn", p.disputa_tipo AS "disputaTipo",
              p.disputa_detalle AS "disputaDetalle",
              r.id AS "reembolsoId", r.estado AS "reembolsoEstado",
              r.via AS "reembolsoVia", r.motivo AS "reembolsoMotivo",
              r.nota AS "reembolsoNota", r.completado_en AS "reembolsoCompletadoEn"
         FROM pagos p LEFT JOIN reembolsos r ON r.pago_id = p.id
        WHERE p.turno_id = $1 AND p.estado <> 'expirado'
        ORDER BY p.creado_en`,
      [turnoId],
    );
    return {
      resumen: await this.calcularResumen(q, turno),
      pagos: (pagos as Record<string, unknown>[]).map((p) => ({
        ...p,
        montoCentavos: Number(p.montoCentavos),
      })),
    };
  }

  // ----------------------------------------------------------- checkout

  /**
   * Checkout de Wompi para un turno propio del cliente. El monto, la
   * referencia, la expiracion y la firma de integridad se arman aca.
   */
  async checkout(
    turnoId: string,
    concepto: Concepto,
    usuario: { sub: string; email?: string },
  ): Promise<Checkout> {
    const tallerId = this.db.exigirTaller();
    const turno = await this.turnoVisible(turnoId);
    if (turno.usuarioId !== usuario.sub) {
      throw new NotFoundException(`Turno ${turnoId} no encontrado`);
    }
    if (turno.tallerId !== tallerId) {
      throw new BadRequestException(
        'Ese turno es de otro taller: elegi ese taller para pagarlo.',
      );
    }
    if (turno.estado === 'cancelado') {
      throw new ConflictException(
        'El turno esta cancelado: no hay nada que pagar.',
      );
    }

    const q = this.db.ejecutor();
    const { pagadoCentavos } = await this.calcularResumen(q, turno);
    let monto: number;
    let venceEn: Date | null = null;
    let condicionesVersion: number | null = null;
    if (concepto === 'anticipo') {
      if (turno.anticipoEstado !== 'pendiente') {
        throw new ConflictException(
          turno.anticipoEstado === 'pagado'
            ? 'El anticipo ya esta pagado.'
            : 'Este turno no requiere anticipo.',
        );
      }
      if (
        turno.anticipoVenceEn &&
        turno.anticipoVenceEn.getTime() <= Date.now()
      ) {
        throw new ConflictException(
          'Se vencio el plazo para pagar el anticipo: el horario se libero.',
        );
      }
      // Las condiciones dicen cuando se devuelve el anticipo: se aceptan
      // (la version vigente) antes de pagar.
      condicionesVersion = await exigirCondiciones(
        q,
        tallerId,
        usuario.sub,
        'pagar',
      );
      monto = (num(turno.anticipoCentavos) ?? 0) - pagadoCentavos;
      venceEn = turno.anticipoVenceEn;
    } else {
      if (turno.anticipoEstado === 'pendiente') {
        throw new ConflictException('Primero hay que pagar el anticipo.');
      }
      monto = (num(turno.totalCentavos) ?? 0) - pagadoCentavos;
    }
    if (monto <= 0) {
      throw new ConflictException('No hay saldo pendiente en este turno.');
    }

    const credenciales = await this.wompi.credenciales(tallerId);
    if (!credenciales) {
      throw new ConflictException(
        'Este taller todavia no recibe pagos en linea. Paga en el taller.',
      );
    }

    const id = randomUUID();
    const referencia = nuevaReferencia(id);
    // La expiracion va firmada: Wompi no deja pagar despues, y el turno se
    // libera a esa hora. Si falta menos de un minuto, sin expiracion (la
    // conciliacion y el vencimiento se encargan).
    const expiracion =
      venceEn && venceEn.getTime() - Date.now() > 60_000
        ? venceEn.toISOString()
        : undefined;
    await q.query(
      `INSERT INTO pagos (id, taller_id, turno_id, usuario_id, concepto, canal,
                          monto_centavos, referencia, estado, vence_en,
                          condiciones_version)
       VALUES ($1, $2, $3, $4, $5, 'wompi', $6, $7, 'creado', $8, $9)`,
      [
        id,
        tallerId,
        turnoId,
        usuario.sub,
        concepto,
        monto,
        referencia,
        expiracion ?? null,
        condicionesVersion,
      ],
    );

    const base = (process.env.WEB_URL ?? 'http://localhost:5173').replace(
      /\/$/,
      '',
    );
    return {
      url: urlCheckout({
        llavePublica: credenciales.llavePublica,
        referencia,
        montoCentavos: monto,
        firma: firmaIntegridad({
          referencia,
          montoCentavos: monto,
          moneda: 'COP',
          expiracion,
          secreto: credenciales.secretoIntegridad,
        }),
        redireccion: `${base}/pagos/resultado?referencia=${referencia}`,
        expiracion,
        email: usuario.email,
      }),
      referencia,
      montoCentavos: monto,
      venceEn: expiracion ?? null,
    };
  }

  /**
   * Estado de un pago del cliente (la pantalla a la que vuelve del
   * checkout). Si todavia no hay respuesta final, se le pregunta a Wompi
   * desde el servidor: el id que trae la redireccion no se usa.
   */
  async estadoPorReferencia(referencia: string, usuarioId: string) {
    const buscar = async () =>
      (
        (await this.db.query(
          `${SELECT_PAGO} WHERE p.referencia = $1 AND p.usuario_id = $2`,
          [referencia, usuarioId],
        )) as FilaPago[]
      )[0];
    let pago = await buscar();
    if (!pago) throw new NotFoundException('Pago no encontrado.');
    if (pago.estado === 'creado' || pago.estado === 'pendiente') {
      await this.conciliarPago(pago.tallerId, pago.referencia!).catch((e) =>
        this.logger.warn(
          `No se pudo conciliar ${referencia}: ${(e as Error).message}`,
        ),
      );
      pago = await buscar();
    }
    return {
      referencia,
      estado: pago.estado,
      concepto: pago.concepto,
      montoCentavos: Number(pago.montoCentavos),
      metodo: pago.metodo,
      turnoId: pago.turnoId,
      tallerId: pago.tallerId,
    };
  }

  // ------------------------------------------------------------ eventos

  /**
   * Webhook de eventos de Wompi del taller. Sin sesion: la autenticidad la
   * da el checksum con el secreto de eventos DEL TALLER. Idempotente: el
   * mismo evento se registra una vez (eventos_wompi) y si ya estaba, no se
   * procesa de nuevo.
   */
  async procesarEvento(
    tallerId: string,
    evento: EventoWompi,
    encabezado?: string,
  ): Promise<{ resultado: string }> {
    const credenciales = await this.wompi.credenciales(tallerId);
    if (
      !credenciales ||
      !eventoAutentico(evento, credenciales.secretoEventos, encabezado)
    ) {
      throw new UnauthorizedException('Firma del evento invalida.');
    }
    const tx = evento.data?.transaction;
    if (evento.event !== 'transaction.updated' || !tx?.id || !tx.reference) {
      return { resultado: 'ignorado' };
    }

    const resultado = await this.db.sistema(async (m) => {
      const [nuevo] = await m.query(
        `INSERT INTO eventos_wompi (taller_id, transaccion_id, estado, timestamp_evento,
                                    referencia, resultado)
         VALUES ($1, $2, $3, $4, $5, 'procesando')
         ON CONFLICT DO NOTHING
         RETURNING transaccion_id`,
        [tallerId, tx.id, tx.status, evento.timestamp, tx.reference],
      );
      if (!nuevo) return 'duplicado';
      const r = await this.aplicarTransaccion(
        m,
        tallerId,
        tx,
        new Date((evento.timestamp ?? 0) * 1000),
      );
      await m.query(
        `UPDATE eventos_wompi SET resultado = $5
          WHERE taller_id = $1 AND transaccion_id = $2 AND estado = $3
            AND timestamp_evento = $4`,
        [tallerId, tx.id, tx.status, evento.timestamp, r],
      );
      return r;
    });
    await this.ejecutarAnulaciones(tallerId);
    return { resultado };
  }

  /**
   * Aplica lo que Wompi dice de una transaccion (evento o conciliacion) al
   * pago de su referencia. Corre en modo sistema, con el pago bloqueado.
   */
  private async aplicarTransaccion(
    m: Consultable,
    tallerId: string,
    tx: TransaccionWompi,
    eventoEn: Date | null,
  ): Promise<string> {
    const [pago] = (await m.query(
      `${SELECT_PAGO} WHERE p.referencia = $1 AND p.taller_id = $2 FOR UPDATE`,
      [tx.reference, tallerId],
    )) as FilaPago[];
    if (!pago) {
      this.logger.warn(
        `Evento de Wompi con referencia desconocida: ${tx.reference}`,
      );
      return 'referencia_desconocida';
    }

    // El monto firmado es el del pago. Uno distinto no se da por pagado.
    if (
      tx.amount_in_cents !== Number(pago.montoCentavos) ||
      tx.currency !== 'COP'
    ) {
      await this.alertar(
        m,
        tallerId,
        pago.id,
        'monto_inconsistente',
        `Wompi informo ${tx.amount_in_cents} ${tx.currency} para un pago de ${pago.montoCentavos} COP (referencia ${tx.reference}). No se dio por pagado.`,
      );
      return 'monto_inconsistente';
    }

    // Otra transaccion con la misma referencia (el cliente pago dos veces
    // el mismo checkout): si se aprobo, es un pago de mas y se devuelve.
    if (pago.wompiTransaccionId && pago.wompiTransaccionId !== tx.id) {
      if (tx.status !== 'APPROVED') return 'otra_transaccion_ignorada';
      const [existente] = await m.query(
        'SELECT 1 FROM pagos WHERE wompi_transaccion_id = $1',
        [tx.id],
      );
      if (existente) return 'sin_cambio';
      const idDuplicado = randomUUID();
      await m.query(
        `INSERT INTO pagos (id, taller_id, turno_id, usuario_id, concepto, canal,
                            monto_centavos, referencia, estado, wompi_transaccion_id,
                            metodo, estado_proveedor, ultimo_evento_en, aprobado_en,
                            duplicado)
         VALUES ($1, $2, $3, $4, $5, 'wompi', $6, $7, 'aprobado', $8, $9, $10, $11,
                 now(), true)`,
        [
          idDuplicado,
          tallerId,
          pago.turnoId,
          pago.usuarioId,
          pago.concepto,
          pago.montoCentavos,
          `${pago.referencia}#${tx.id}`,
          tx.id,
          tx.payment_method_type ?? null,
          tx.status,
          eventoEn,
        ],
      );
      await this.crearReembolso(
        m,
        {
          ...pago,
          id: idDuplicado,
          wompiTransaccionId: tx.id,
          metodo: tx.payment_method_type ?? null,
        },
        'pago_duplicado',
      );
      await this.alertar(
        m,
        tallerId,
        idDuplicado,
        'pago_duplicado',
        'El cliente pago dos veces el mismo cobro. El segundo pago se devuelve.',
      );
      return 'duplicado_devuelto';
    }

    const nuevo = estadoDeWompi(tx.status);
    if (
      !aplicaTransicion({
        actual: pago.estado,
        nuevo,
        eventoEn,
        ultimoEventoEn: pago.ultimoEventoEn,
      })
    ) {
      return 'sin_cambio';
    }
    await m.query(
      `UPDATE pagos
          SET estado = $2, wompi_transaccion_id = $3, metodo = coalesce($4, metodo),
              estado_proveedor = $5, ultimo_evento_en = coalesce($6, ultimo_evento_en),
              aprobado_en = CASE WHEN $2 = 'aprobado' THEN now() ELSE aprobado_en END,
              actualizado_en = now()
        WHERE id = $1`,
      [
        pago.id,
        nuevo,
        tx.id,
        tx.payment_method_type ?? null,
        tx.status,
        eventoEn,
      ],
    );
    const actualizado = {
      ...pago,
      estado: nuevo,
      wompiTransaccionId: tx.id,
      metodo: tx.payment_method_type ?? pago.metodo,
    };

    if (nuevo === 'aprobado') await this.alAprobar(m, actualizado);
    if (nuevo === 'anulado') await this.alAnular(m, actualizado);
    return nuevo;
  }

  /** Un pago aprobado confirma el turno o, si ya no se puede, se devuelve. */
  private async alAprobar(m: Consultable, pago: FilaPago): Promise<void> {
    let turno = await this.turnoParaActualizar(m, pago.turnoId);

    // El turno se reprogramo mientras se pagaba: el pago va al nuevo.
    while (turno.estado === 'cancelado' && turno.reprogramadoA) {
      await m.query('UPDATE pagos SET turno_id = $2 WHERE id = $1', [
        pago.id,
        turno.reprogramadoA,
      ]);
      pago = { ...pago, turnoId: turno.reprogramadoA };
      turno = await this.turnoParaActualizar(m, turno.reprogramadoA);
    }

    if (turno.estado === 'cancelado') {
      // Pago tardio: el turno se libero por falta de pago. Si el horario
      // sigue libre y todavia no paso, se reactiva; si no, se devuelve.
      if (
        turno.canceladoPor === 'sistema' &&
        turno.inicio.getTime() > Date.now()
      ) {
        await m.query('SAVEPOINT reactivar');
        try {
          await m.query(
            `UPDATE turnos SET estado = 'programado', cancelado_por = NULL,
                    cancelado_en = NULL, motivo_cancelacion = NULL,
                    anticipo_estado = 'pagado', anticipo_vence_en = NULL,
                    actualizado_en = now()
              WHERE id = $1`,
            [turno.id],
          );
          await m.query('RELEASE SAVEPOINT reactivar');
          await this.alertar(
            m,
            turno.tallerId,
            pago.id,
            'pago_tardio',
            'El anticipo se pago despues del plazo; el horario seguia libre y el turno se reactivo.',
          );
          return;
        } catch (error) {
          await m.query('ROLLBACK TO SAVEPOINT reactivar');
          if (
            (error as { code?: string; driverError?: { code?: string } })
              .code !== '23P01' &&
            (error as { driverError?: { code?: string } }).driverError?.code !==
              '23P01'
          ) {
            throw error;
          }
        }
      }
      await this.crearReembolso(m, pago, 'turno_liberado');
      await this.alertar(
        m,
        turno.tallerId,
        pago.id,
        'pago_tardio',
        'Llego un pago para un turno cancelado o sin horario disponible: se devuelve.',
      );
      return;
    }

    const objetivo =
      pago.concepto === 'anticipo'
        ? (num(turno.anticipoCentavos) ?? 0)
        : (num(turno.totalCentavos) ?? 0);
    const [{ pagado }] = await m.query(SQL_PAGADO, [turno.id]);
    const sinEste = Number(pagado) - Number(pago.montoCentavos);
    if (sinEste >= objetivo) {
      await m.query('UPDATE pagos SET duplicado = true WHERE id = $1', [
        pago.id,
      ]);
      await this.crearReembolso(m, pago, 'pago_duplicado');
      await this.alertar(
        m,
        turno.tallerId,
        pago.id,
        'pago_duplicado',
        'Llego un pago por algo que ya estaba pagado: se devuelve.',
      );
      return;
    }
    await this.recalcularAnticipo(m, turno.id);
  }

  /** VOIDED: la devolucion pedida termino, o alguien anulo por fuera. */
  private async alAnular(m: Consultable, pago: FilaPago): Promise<void> {
    const [completado] = await m.query(
      `UPDATE reembolsos SET estado = 'completado', completado_en = now(), actualizado_en = now()
        WHERE pago_id = $1 AND estado IN ('por_anular', 'solicitado')
        RETURNING id`,
      [pago.id],
    );
    if (!completado) {
      await this.alertar(
        m,
        pago.tallerId,
        pago.id,
        'anulacion_externa',
        'Wompi informo la anulacion de un pago que TurnoPro no pidio devolver. Revisa si fue una reversion del banco.',
      );
    }
    await this.recalcularAnticipo(m, pago.turnoId);
  }

  /**
   * anticipo_estado segun lo pagado: pagado si cubre el anticipo; si deja
   * de cubrirlo (reversion) vuelve a pendiente, sin vencimiento (el turno
   * ya estaba confirmado; lo decide el taller).
   */
  private async recalcularAnticipo(
    m: Consultable,
    turnoId: string,
  ): Promise<void> {
    await m.query(
      `UPDATE turnos t
          SET anticipo_estado = CASE WHEN (${SQL_PAGADO.replace('$1', 't.id')}) >= t.anticipo_centavos
                                     THEN 'pagado' ELSE 'pendiente' END,
              anticipo_vence_en = CASE WHEN (${SQL_PAGADO.replace('$1', 't.id')}) >= t.anticipo_centavos
                                       THEN NULL ELSE t.anticipo_vence_en END,
              actualizado_en = now()
        WHERE t.id = $1 AND t.anticipo_estado <> 'no_requiere'
          AND t.anticipo_centavos IS NOT NULL`,
      [turnoId],
    );
  }

  // --------------------------------------------------------- devoluciones

  /**
   * Devuelve todo lo pagado de un turno cancelado (anticipo completo):
   * cancelado por el cliente dentro de la ventana, o por el taller. Corre
   * DESPUES del commit de la cancelacion, en modo sistema (el cliente que
   * cancela no puede escribir reembolsos).
   */
  devolverAlCancelar(turnoId: string, motivo: MotivoReembolso): void {
    this.db.despuesDeConfirmar(async () => {
      const tallerId = await this.db.sistema(async (m) => {
        const pagos = (await m.query(
          `${SELECT_PAGO}
            WHERE p.turno_id = $1 AND p.estado IN ('aprobado', 'en_disputa')
              AND NOT EXISTS (SELECT 1 FROM reembolsos r WHERE r.pago_id = p.id)
            FOR UPDATE`,
          [turnoId],
        )) as FilaPago[];
        for (const pago of pagos) await this.crearReembolso(m, pago, motivo);
        return pagos[0]?.tallerId ?? null;
      });
      if (tallerId) await this.ejecutarAnulaciones(tallerId);
    });
  }

  /** Reprogramar: lo pagado del turno viejo pasa al nuevo. */
  transferirAlReprogramar(originalId: string, nuevoId: string): void {
    this.db.despuesDeConfirmar(async () => {
      await this.db.sistema(async (m) => {
        await m.query(
          `UPDATE pagos SET turno_id = $2, actualizado_en = now()
            WHERE turno_id = $1 AND estado IN ('aprobado', 'en_disputa', 'pendiente', 'creado')`,
          [originalId, nuevoId],
        );
        await this.recalcularAnticipo(m, nuevoId);
      });
    });
  }

  private async crearReembolso(
    m: Consultable,
    pago: Pick<
      FilaPago,
      | 'id'
      | 'tallerId'
      | 'canal'
      | 'metodo'
      | 'wompiTransaccionId'
      | 'montoCentavos'
    >,
    motivo: MotivoReembolso,
  ): Promise<void> {
    // Tarjeta: se anula por la API (despues del commit). El resto (PSE,
    // Nequi, Bancolombia, mostrador) no tiene devolucion por API.
    const porApi =
      pago.canal === 'wompi' &&
      pago.metodo === 'CARD' &&
      !!pago.wompiTransaccionId;
    const [creado] = await m.query(
      `INSERT INTO reembolsos (taller_id, pago_id, monto_centavos, motivo, estado, via)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (pago_id) DO NOTHING
       RETURNING id`,
      [
        pago.tallerId,
        pago.id,
        pago.montoCentavos,
        motivo,
        porApi ? 'por_anular' : 'pendiente_manual',
        porApi ? 'wompi_anulacion' : 'manual',
      ],
    );
    if (creado && !porApi) {
      await this.alertar(
        m,
        pago.tallerId,
        pago.id,
        'reembolso_pendiente',
        `Hay que devolver $ ${(Number(pago.montoCentavos) / 100).toLocaleString('es-CO')} a mano (${pago.metodo ?? pago.canal}): este medio no tiene devolucion automatica.`,
      );
    }
  }

  /**
   * Pide a Wompi las anulaciones de tarjeta que quedaron por hacer. Fuera de
   * cualquier transaccion: primero la llamada, despues el registro. Si el
   * proceso se cae en el medio, la conciliacion vuelve a intentar.
   */
  async ejecutarAnulaciones(tallerId: string): Promise<void> {
    const pendientes = (await this.db.sistema((m) =>
      m.query(
        `SELECT r.id, p.wompi_transaccion_id AS "transaccionId", p.id AS "pagoId"
           FROM reembolsos r JOIN pagos p ON p.id = r.pago_id
          WHERE r.taller_id = $1 AND r.estado = 'por_anular'`,
        [tallerId],
      ),
    )) as { id: string; transaccionId: string; pagoId: string }[];
    if (!pendientes.length) return;
    const credenciales = await this.wompi.credenciales(tallerId);
    for (const r of pendientes) {
      const resultado = credenciales
        ? await this.wompi.anular(credenciales, r.transaccionId)
        : {
            ok: false as const,
            motivo: 'El taller ya no tiene credenciales de Wompi.',
          };
      await this.db.sistema(async (m) => {
        if (resultado.ok) {
          await m.query(
            `UPDATE reembolsos SET estado = 'solicitado', actualizado_en = now()
              WHERE id = $1 AND estado = 'por_anular'`,
            [r.id],
          );
        } else {
          await m.query(
            `UPDATE reembolsos SET estado = 'pendiente_manual', via = 'manual', nota = $2,
                    actualizado_en = now()
              WHERE id = $1 AND estado = 'por_anular'`,
            [r.id, `La anulacion automatica fallo: ${resultado.motivo}`],
          );
          await this.alertar(
            m,
            tallerId,
            r.pagoId,
            'reembolso_fallido',
            'Wompi no acepto la anulacion automatica. Hay que devolver el dinero a mano o desde el panel de Wompi.',
          );
        }
      });
    }
  }

  /** El taller registra que devolvio el dinero a mano. */
  async completarReembolso(
    id: string,
    nota: string,
    usuarioId: string,
  ): Promise<void> {
    const [fila] = (await this.db.query(
      `UPDATE reembolsos SET estado = 'completado', completado_en = now(), nota = $2,
              registrado_por = $3, actualizado_en = now()
        WHERE id = $1 AND estado = 'pendiente_manual'
        RETURNING id`,
      [id, nota.trim(), usuarioId],
    )) as { id: string }[];
    if (!fila) {
      throw new NotFoundException(
        'Reembolso no encontrado o no esta pendiente de registro manual.',
      );
    }
  }

  async reembolsos(soloPendientes: boolean) {
    const tallerId = this.db.exigirTaller();
    const filas = (await this.db.query(
      `SELECT r.id, r.estado, r.via, r.motivo, r.monto_centavos::bigint AS "montoCentavos",
              r.nota, r.creado_en AS "creadoEn", r.completado_en AS "completadoEn",
              p.id AS "pagoId", p.canal, p.metodo, p.turno_id AS "turnoId",
              lower(t.rango_tiempo) AS "turnoInicio", u.nombre AS cliente
         FROM reembolsos r
         JOIN pagos p ON p.id = r.pago_id
         JOIN turnos t ON t.id = p.turno_id
         LEFT JOIN usuarios u ON u.id = p.usuario_id
        WHERE r.taller_id = $1 AND ($2::boolean = false OR r.estado <> 'completado')
        ORDER BY r.creado_en DESC
        LIMIT 200`,
      [tallerId, soloPendientes],
    )) as Record<string, unknown>[];
    return filas.map((f) => ({ ...f, montoCentavos: Number(f.montoCentavos) }));
  }

  // --------------------------------------------------------- mostrador

  async registrarPresencial(
    dto: {
      turnoId: string;
      concepto: Concepto;
      medio: MedioPresencial;
      montoCentavos?: number;
      comprobante?: string;
    },
    usuarioId: string,
  ) {
    const tallerId = this.db.exigirTaller();
    const turno = await this.turnoVisible(dto.turnoId);
    if (turno.tallerId !== tallerId)
      throw new NotFoundException(`Turno ${dto.turnoId} no encontrado`);
    if (turno.estado === 'cancelado') {
      throw new ConflictException('El turno esta cancelado.');
    }
    const q = this.db.ejecutor();
    const { pagadoCentavos } = await this.calcularResumen(q, turno);
    const objetivo =
      dto.concepto === 'anticipo'
        ? num(turno.anticipoCentavos)
        : num(turno.totalCentavos);
    if (objetivo === null) {
      throw new BadRequestException(
        dto.concepto === 'anticipo'
          ? 'Este turno no tiene anticipo.'
          : 'El turno no tiene precio.',
      );
    }
    const pendiente = objetivo - pagadoCentavos;
    if (pendiente <= 0)
      throw new ConflictException('No hay nada pendiente por ese concepto.');
    const monto = dto.montoCentavos ?? pendiente;
    if (monto > pendiente) {
      throw new BadRequestException(
        `El monto supera lo pendiente (${pendiente / 100} COP).`,
      );
    }
    if (
      (dto.medio === 'datafono' || dto.medio === 'transferencia') &&
      !dto.comprobante?.trim()
    ) {
      throw new BadRequestException(
        'Anota el comprobante (numero del voucher del datafono o de la transferencia).',
      );
    }
    const [pago] = (await q.query(
      `INSERT INTO pagos (taller_id, turno_id, usuario_id, concepto, canal, monto_centavos,
                          estado, metodo, registrado_por, comprobante, aprobado_en)
       VALUES ($1, $2, $3, $4, $5, $6, 'aprobado', $5, $7, $8, now())
       RETURNING id`,
      [
        tallerId,
        turno.id,
        turno.usuarioId,
        dto.concepto,
        dto.medio,
        monto,
        usuarioId,
        dto.comprobante?.trim() || null,
      ],
    )) as { id: string }[];
    await this.recalcularAnticipo(q, turno.id);
    return { id: pago.id, montoCentavos: monto };
  }

  // ----------------------------------------------------------- disputas

  /**
   * Reversion del pago (Ley 1480 de 2011, articulo 51) o contracargo: el
   * banco o Wompi le avisan al taller y el taller la registra aca. Queda en
   * disputa hasta que se resuelve.
   */
  async abrirDisputa(
    pagoId: string,
    tipo: 'reversion' | 'contracargo',
    detalle: string,
  ) {
    const tallerId = this.db.exigirTaller();
    const [pago] = (await this.db.query(
      `UPDATE pagos SET estado = 'en_disputa', disputa_tipo = $2, disputa_detalle = $3,
              actualizado_en = now()
        WHERE id = $1 AND taller_id = $4 AND estado = 'aprobado'
        RETURNING id`,
      [pagoId, tipo, detalle.trim(), tallerId],
    )) as { id: string }[];
    if (!pago) throw new NotFoundException('Pago aprobado no encontrado.');
    await this.alertar(
      this.db.ejecutor(),
      tallerId,
      pagoId,
      tipo,
      tipo === 'reversion'
        ? `Reversion del pago solicitada (Ley 1480, art. 51): ${detalle.trim()}`
        : `Contracargo: ${detalle.trim()}`,
    );
  }

  async resolverDisputa(pagoId: string, resultado: 'revertido' | 'a_favor') {
    const tallerId = this.db.exigirTaller();
    const [pago] = (await this.db.query(
      `UPDATE pagos SET estado = $2, actualizado_en = now()
        WHERE id = $1 AND taller_id = $3 AND estado = 'en_disputa'
        RETURNING turno_id AS "turnoId"`,
      [pagoId, resultado === 'revertido' ? 'revertido' : 'aprobado', tallerId],
    )) as { turnoId: string }[];
    if (!pago) throw new NotFoundException('Pago en disputa no encontrado.');
    await this.recalcularAnticipo(this.db.ejecutor(), pago.turnoId);
  }

  // ------------------------------------------------------------ alertas

  async alertas(abiertas: boolean) {
    const tallerId = this.db.exigirTaller();
    return this.db.query(
      `SELECT a.id, a.tipo, a.mensaje, a.pago_id AS "pagoId", a.creada_en AS "creadaEn",
              a.atendida_en AS "atendidaEn", p.turno_id AS "turnoId"
         FROM alertas_pago a LEFT JOIN pagos p ON p.id = a.pago_id
        WHERE a.taller_id = $1 AND ($2::boolean = false OR a.atendida_en IS NULL)
        ORDER BY a.creada_en DESC
        LIMIT 200`,
      [tallerId, abiertas],
    );
  }

  async atenderAlerta(id: string, usuarioId: string): Promise<void> {
    const [fila] = (await this.db.query(
      `UPDATE alertas_pago SET atendida_en = now(), atendida_por = $2
        WHERE id = $1 AND atendida_en IS NULL RETURNING id`,
      [id, usuarioId],
    )) as { id: string }[];
    if (!fila)
      throw new NotFoundException('Alerta no encontrada o ya atendida.');
  }

  private async alertar(
    m: Consultable,
    tallerId: string,
    pagoId: string | null,
    tipo: TipoAlerta,
    mensaje: string,
  ): Promise<void> {
    await m.query(
      `INSERT INTO alertas_pago (taller_id, pago_id, tipo, mensaje) VALUES ($1, $2, $3, $4)`,
      [tallerId, pagoId, tipo, mensaje],
    );
    this.logger.warn(
      `Alerta de pago (${tipo}) en el taller ${tallerId}: ${mensaje}`,
    );
  }

  // --------------------------------------------------------------- caja

  /**
   * Cuadre del dia (hora del taller): lo cobrado por medio, lo devuelto a
   * mano y el efectivo que deberia haber en la caja.
   */
  async caja(fecha: string) {
    const tallerId = this.db.exigirTaller();
    const zona = zonaHorariaNegocio();
    const cobros = (await this.db.query(
      `SELECT p.canal, coalesce(p.metodo, p.canal) AS metodo,
              count(*)::int AS cantidad, sum(p.monto_centavos)::bigint AS total
         FROM pagos p
        WHERE p.taller_id = $1 AND p.aprobado_en IS NOT NULL
          AND (p.aprobado_en AT TIME ZONE $3)::date = $2::date
          AND p.estado IN ('aprobado', 'en_disputa', 'revertido', 'anulado')
        GROUP BY 1, 2 ORDER BY 1, 2`,
      [tallerId, fecha, zona],
    )) as { canal: string; metodo: string; cantidad: number; total: string }[];
    const devoluciones = (await this.db.query(
      `SELECT p.canal, r.via, count(*)::int AS cantidad, sum(r.monto_centavos)::bigint AS total
         FROM reembolsos r JOIN pagos p ON p.id = r.pago_id
        WHERE r.taller_id = $1 AND r.estado = 'completado'
          AND (r.completado_en AT TIME ZONE $3)::date = $2::date
        GROUP BY 1, 2`,
      [tallerId, fecha, zona],
    )) as { canal: string; via: string; cantidad: number; total: string }[];
    const movimientos = await this.db.query(
      `SELECT p.id, p.concepto, p.canal, coalesce(p.metodo, p.canal) AS metodo,
              p.monto_centavos::bigint AS "montoCentavos", p.estado, p.comprobante,
              p.aprobado_en AS "aprobadoEn", u.nombre AS cliente, p.turno_id AS "turnoId",
              reg.nombre AS "registradoPor"
         FROM pagos p
         LEFT JOIN usuarios u ON u.id = p.usuario_id
         LEFT JOIN usuarios reg ON reg.id = p.registrado_por
        WHERE p.taller_id = $1 AND p.aprobado_en IS NOT NULL
          AND (p.aprobado_en AT TIME ZONE $3)::date = $2::date
        ORDER BY p.aprobado_en`,
      [tallerId, fecha, zona],
    );
    const [cierre] = (await this.db.query(
      `SELECT c.esperado_centavos::bigint AS "esperadoCentavos",
              c.contado_centavos::bigint AS "contadoCentavos", c.nota,
              c.cerrado_en AS "cerradoEn", u.nombre AS "cerradoPor"
         FROM cierres_caja c LEFT JOIN usuarios u ON u.id = c.cerrado_por
        WHERE c.taller_id = $1 AND c.fecha = $2::date`,
      [tallerId, fecha],
    )) as Record<string, unknown>[];

    const efectivoCobrado = cobros
      .filter((c) => c.canal === 'efectivo')
      .reduce((s, c) => s + Number(c.total), 0);
    // Las devoluciones manuales de pagos en efectivo salen de la caja.
    const efectivoDevuelto = devoluciones
      .filter((d) => d.canal === 'efectivo')
      .reduce((s, d) => s + Number(d.total), 0);
    return {
      fecha,
      cobros: cobros.map((c) => ({ ...c, total: Number(c.total) })),
      devoluciones: devoluciones.map((d) => ({ ...d, total: Number(d.total) })),
      totalCobrado: cobros.reduce((s, c) => s + Number(c.total), 0),
      efectivoEsperado: efectivoCobrado - efectivoDevuelto,
      movimientos: (movimientos as Record<string, unknown>[]).map((m) => ({
        ...m,
        montoCentavos: Number(m.montoCentavos),
      })),
      cierre: cierre
        ? {
            ...cierre,
            esperadoCentavos: Number(cierre.esperadoCentavos),
            contadoCentavos: Number(cierre.contadoCentavos),
            diferenciaCentavos:
              Number(cierre.contadoCentavos) - Number(cierre.esperadoCentavos),
          }
        : null,
    };
  }

  async cerrarCaja(
    fecha: string,
    contadoCentavos: number,
    nota: string | undefined,
    usuarioId: string,
  ) {
    const tallerId = this.db.exigirTaller();
    const hoy = fechaEnZona(new Date(), zonaHorariaNegocio());
    if (fecha > hoy)
      throw new BadRequestException('No se puede cerrar un dia que no llego.');
    const { efectivoEsperado } = await this.caja(fecha);
    try {
      await this.db.query(
        `INSERT INTO cierres_caja (taller_id, fecha, esperado_centavos, contado_centavos,
                                   nota, cerrado_por)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          tallerId,
          fecha,
          efectivoEsperado,
          contadoCentavos,
          nota?.trim() || null,
          usuarioId,
        ],
      );
    } catch (error) {
      const e = error as { code?: string; driverError?: { code?: string } };
      if ((e.code ?? e.driverError?.code) === '23505') {
        throw new ConflictException('Ese dia ya tiene cierre de caja.');
      }
      throw error;
    }
    return this.caja(fecha);
  }

  // -------------------------------------------------------- conciliacion

  /** Consulta a Wompi el estado de un pago y lo aplica. */
  async conciliarPago(tallerId: string, referencia: string): Promise<void> {
    const credenciales = await this.wompi.credenciales(tallerId);
    if (!credenciales) return;
    const transacciones = await this.wompi.transaccionesPorReferencia(
      credenciales,
      referencia,
    );
    for (const tx of transacciones) {
      await this.db.sistema((m) =>
        this.aplicarTransaccion(m, tallerId, tx, null),
      );
    }
    await this.ejecutarAnulaciones(tallerId);
  }

  /**
   * Conciliacion periodica (PagosScheduler): los checkouts y transacciones
   * que quedaron sin estado final, las anulaciones por pedir y las pedidas
   * que no confirmaron.
   */
  async conciliar(): Promise<{ revisados: number; expirados: number }> {
    const porRevisar = (await this.db.sistema((m) =>
      m.query(
        `SELECT taller_id AS "tallerId", referencia
           FROM pagos
          WHERE canal = 'wompi' AND estado IN ('creado', 'pendiente')
            AND creado_en < now() - interval '2 minutes'
            AND creado_en > now() - make_interval(hours => $1)
          ORDER BY creado_en
          LIMIT 200`,
        [HORAS_CHECKOUT * 2],
      ),
    )) as { tallerId: string; referencia: string }[];
    for (const p of porRevisar) {
      await this.conciliarPago(p.tallerId, p.referencia).catch((e) =>
        this.logger.warn(
          `Conciliacion de ${p.referencia} fallo: ${(e as Error).message}`,
        ),
      );
    }

    // Checkouts que nadie uso.
    const expirados = (await this.db.sistema((m) =>
      m.query(
        `UPDATE pagos SET estado = 'expirado', actualizado_en = now()
          WHERE canal = 'wompi' AND estado = 'creado'
            AND creado_en < now() - make_interval(hours => $1)
          RETURNING id`,
        [HORAS_CHECKOUT],
      ),
    )) as unknown[];

    // Anulaciones por pedir (el proceso se cayo) y pedidas sin confirmar.
    const talleres = (await this.db.sistema((m) =>
      m.query(
        `SELECT DISTINCT r.taller_id AS "tallerId" FROM reembolsos r
          WHERE r.estado = 'por_anular'
             OR (r.estado = 'solicitado' AND r.actualizado_en < now() - interval '10 minutes')`,
      ),
    )) as { tallerId: string }[];
    for (const { tallerId } of talleres) {
      await this.ejecutarAnulaciones(tallerId);
      const solicitados = (await this.db.sistema((m) =>
        m.query(
          `SELECT p.referencia FROM reembolsos r JOIN pagos p ON p.id = r.pago_id
            WHERE r.taller_id = $1 AND r.estado = 'solicitado'
              AND r.actualizado_en < now() - interval '10 minutes'`,
          [tallerId],
        ),
      )) as { referencia: string }[];
      for (const { referencia } of solicitados) {
        await this.conciliarPago(tallerId, referencia.split('#')[0]).catch(
          () => undefined,
        );
      }
    }
    return { revisados: porRevisar.length, expirados: expirados.length };
  }

  /**
   * Libera los turnos cuyo anticipo no se pago a tiempo. Antes, concilia
   * sus pagos (un PSE aprobado cuyo evento todavia no llego no se pierde),
   * y no toca los que tienen una transaccion en proceso reciente.
   */
  async liberarVencidos(): Promise<number> {
    const candidatos = (await this.db.sistema((m) =>
      m.query(
        `SELECT t.id, t.taller_id AS "tallerId"
           FROM turnos t
          WHERE t.estado = 'programado' AND t.anticipo_estado = 'pendiente'
            AND t.anticipo_vence_en < now()
          LIMIT 200`,
      ),
    )) as { id: string; tallerId: string }[];
    let liberados = 0;
    for (const t of candidatos) {
      const referencias = (await this.db.sistema((m) =>
        m.query(
          `SELECT referencia FROM pagos
            WHERE turno_id = $1 AND canal = 'wompi' AND estado IN ('creado', 'pendiente')`,
          [t.id],
        ),
      )) as { referencia: string }[];
      for (const { referencia } of referencias) {
        await this.conciliarPago(t.tallerId, referencia).catch(() => undefined);
      }
      const [liberado] = (await this.db.sistema((m) =>
        m.query(
          `UPDATE turnos t
              SET estado = 'cancelado', cancelado_por = 'sistema', cancelado_en = now(),
                  motivo_cancelacion = 'Se libero: el anticipo no se pago a tiempo',
                  actualizado_en = now()
            WHERE t.id = $1 AND t.estado = 'programado' AND t.anticipo_estado = 'pendiente'
              AND t.anticipo_vence_en < now()
              AND NOT EXISTS (SELECT 1 FROM pagos p
                               WHERE p.turno_id = t.id AND p.estado = 'pendiente'
                                 AND p.creado_en > now() - make_interval(mins => $2))
            RETURNING t.id`,
          [t.id, MINUTOS_GRACIA_PENDIENTE],
        ),
      )) as { id: string }[];
      if (liberado) liberados++;
    }
    if (liberados)
      this.logger.log(`${liberados} turnos liberados por anticipo sin pagar`);
    return liberados;
  }

  // ------------------------------------------------------------ privados

  /** El turno si el usuario lo puede ver (RLS: propio o del taller). */
  private async turnoVisible(turnoId: string): Promise<FilaTurno> {
    const [turno] = (await this.db.query(`${SELECT_TURNO} WHERE t.id = $1`, [
      turnoId,
    ])) as FilaTurno[];
    if (!turno) throw new NotFoundException(`Turno ${turnoId} no encontrado`);
    turno.inicio = new Date(turno.inicio);
    return turno;
  }

  private async turnoParaActualizar(
    m: Consultable,
    turnoId: string,
  ): Promise<FilaTurno> {
    const [turno] = (await m.query(
      `${SELECT_TURNO} WHERE t.id = $1 FOR UPDATE`,
      [turnoId],
    )) as FilaTurno[];
    if (!turno) throw new NotFoundException(`Turno ${turnoId} no encontrado`);
    turno.inicio = new Date(turno.inicio);
    return turno;
  }

  private async calcularResumen(
    q: Consultable,
    turno: FilaTurno,
  ): Promise<ResumenPagos> {
    const [{ pagado }] = (await q.query(SQL_PAGADO, [turno.id])) as {
      pagado: string;
    }[];
    const [{ cobra }] = (await q.query(
      'SELECT taller_cobra_en_linea($1) AS cobra',
      [turno.tallerId],
    )) as { cobra: boolean }[];
    const total = num(turno.totalCentavos);
    const pagadoCentavos = Number(pagado);
    return {
      totalCentavos: total,
      anticipoCentavos: num(turno.anticipoCentavos),
      anticipoEstado: turno.anticipoEstado,
      anticipoVenceEn: turno.anticipoVenceEn
        ? new Date(turno.anticipoVenceEn).toISOString()
        : null,
      pagadoCentavos,
      saldoCentavos:
        total === null ? null : Math.max(0, total - pagadoCentavos),
      cobraEnLinea: cobra,
    };
  }

  /** Para el panel: la URL que el taller configura en Wompi. */
  urlEventos(tallerId: string, base: string): string {
    return `${base.replace(/\/$/, '')}/pagos/wompi/eventos/${tallerId}`;
  }
}
