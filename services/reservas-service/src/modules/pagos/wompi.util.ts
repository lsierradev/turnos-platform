import { createHash, timingSafeEqual } from 'crypto';

/*
 * Wompi (Sprint 24): lo que no depende de la red ni de la base. Todo con
 * pruebas en wompi.util.spec.ts.
 *
 * Referencias (docs.wompi.co, Colombia):
 * - Firma de integridad del checkout: SHA-256 de
 *   referencia + monto en centavos + moneda [+ fecha de expiracion] +
 *   secreto de integridad.
 * - Eventos: SHA-256 de los valores de signature.properties (en ese
 *   orden) + timestamp + secreto de eventos; llega en signature.checksum y
 *   en el encabezado X-Event-Checksum.
 */

export type AmbienteWompi = 'pruebas' | 'produccion';

export function urlApiWompi(ambiente: AmbienteWompi): string {
  return ambiente === 'produccion'
    ? (process.env.WOMPI_API_URL_PRODUCCION ?? 'https://production.wompi.co/v1')
    : (process.env.WOMPI_API_URL_PRUEBAS ?? 'https://sandbox.wompi.co/v1');
}

/** El mismo checkout para los dos ambientes: la llave publica decide. */
export const URL_CHECKOUT_WOMPI =
  process.env.WOMPI_CHECKOUT_URL ?? 'https://checkout.wompi.co/p/';

const sha256 = (texto: string) =>
  createHash('sha256').update(texto, 'utf8').digest('hex');

export function firmaIntegridad(args: {
  referencia: string;
  montoCentavos: number;
  moneda: 'COP';
  /** ISO 8601 en UTC, la misma que va en expiration-time. */
  expiracion?: string;
  secreto: string;
}): string {
  const { referencia, montoCentavos, moneda, expiracion, secreto } = args;
  if (!Number.isSafeInteger(montoCentavos) || montoCentavos <= 0) {
    throw new Error(`Monto invalido para Wompi: ${montoCentavos}`);
  }
  return sha256(
    `${referencia}${montoCentavos}${moneda}${expiracion ?? ''}${secreto}`,
  );
}

/** URL del Web Checkout de Wompi. Todo lo firmado sale del backend. */
export function urlCheckout(args: {
  llavePublica: string;
  referencia: string;
  montoCentavos: number;
  firma: string;
  redireccion: string;
  expiracion?: string;
  email?: string | null;
  nombre?: string | null;
}): string {
  const p = new URLSearchParams({
    'public-key': args.llavePublica,
    currency: 'COP',
    'amount-in-cents': String(args.montoCentavos),
    reference: args.referencia,
    'signature:integrity': args.firma,
    'redirect-url': args.redireccion,
  });
  if (args.expiracion) p.set('expiration-time', args.expiracion);
  if (args.email) p.set('customer-data:email', args.email);
  if (args.nombre) p.set('customer-data:full-name', args.nombre);
  return `${URL_CHECKOUT_WOMPI}?${p.toString()}`;
}

// ------------------------------------------------------------- eventos

export interface EventoWompi {
  event: string;
  data: { transaction?: TransaccionWompi };
  environment?: string;
  signature?: { properties?: string[]; checksum?: string };
  timestamp?: number;
  sent_at?: string;
}

export interface TransaccionWompi {
  id: string;
  reference: string;
  amount_in_cents: number;
  currency: string;
  status: EstadoWompi;
  payment_method_type?: string;
  status_message?: string | null;
}

export type EstadoWompi =
  'PENDING' | 'APPROVED' | 'DECLINED' | 'VOIDED' | 'ERROR';

/** "transaction.id" -> evento.data.transaction.id */
function valorEn(data: unknown, camino: string): unknown {
  return camino
    .split('.')
    .reduce<unknown>(
      (obj, clave) =>
        obj && typeof obj === 'object'
          ? (obj as Record<string, unknown>)[clave]
          : undefined,
      data,
    );
}

/**
 * Verifica el checksum del evento con el secreto de eventos del taller.
 * Si llega el encabezado X-Event-Checksum, tiene que coincidir tambien.
 * Comparacion en tiempo constante.
 */
export function eventoAutentico(
  evento: EventoWompi,
  secreto: string,
  encabezado?: string,
): boolean {
  const props = evento.signature?.properties;
  const recibido = evento.signature?.checksum;
  if (!Array.isArray(props) || !props.length || typeof recibido !== 'string')
    return false;
  if (typeof evento.timestamp !== 'number') return false;
  const valores = props.map((p) => valorEn(evento.data, p));
  if (valores.some((v) => v === undefined || v === null)) return false;
  const esperado = sha256(`${valores.join('')}${evento.timestamp}${secreto}`);
  const iguales = (a: string, b: string) =>
    a.length === b.length &&
    timingSafeEqual(Buffer.from(a.toLowerCase()), Buffer.from(b.toLowerCase()));
  if (!iguales(esperado, recibido)) return false;
  return encabezado === undefined || iguales(esperado, encabezado);
}

// ------------------------------------------------------------- estados

export type EstadoPago =
  | 'creado'
  | 'pendiente'
  | 'aprobado'
  | 'rechazado'
  | 'error'
  | 'anulado'
  | 'expirado'
  | 'en_disputa'
  | 'revertido';

export function estadoDeWompi(estado: EstadoWompi): EstadoPago {
  switch (estado) {
    case 'APPROVED':
      return 'aprobado';
    case 'DECLINED':
      return 'rechazado';
    case 'VOIDED':
      return 'anulado';
    case 'ERROR':
      return 'error';
    default:
      return 'pendiente';
  }
}

/*
 * Orden de los estados de una transaccion: PENDING -> final (APPROVED,
 * DECLINED, ERROR) y un APPROVED puede terminar VOIDED. Los eventos pueden
 * llegar fuera de orden (un PENDING atrasado despues del APPROVED), y la
 * conciliacion puede ver un estado antes que el webhook.
 */
const RANGO: Partial<Record<EstadoPago, number>> = {
  creado: 0,
  expirado: 0,
  pendiente: 1,
  rechazado: 2,
  error: 2,
  aprobado: 3,
  anulado: 4,
};

/**
 * Si un estado informado por Wompi reemplaza al actual. Nunca se
 * retrocede (un PENDING viejo no deshace un APPROVED; un DECLINED no pisa
 * un APPROVED). Entre dos del mismo rango (rechazado vs error) gana el
 * evento mas nuevo. Una disputa la maneja el taller: Wompi no la toca,
 * salvo un VOIDED (el dinero ya se devolvio).
 */
export function aplicaTransicion(args: {
  actual: EstadoPago;
  nuevo: EstadoPago;
  eventoEn?: Date | null;
  ultimoEventoEn?: Date | null;
}): boolean {
  const { actual, nuevo, eventoEn, ultimoEventoEn } = args;
  if (actual === nuevo) return false;
  if (actual === 'en_disputa' || actual === 'revertido') {
    return nuevo === 'anulado' && actual === 'en_disputa';
  }
  const ra = RANGO[actual];
  const rn = RANGO[nuevo];
  if (ra === undefined || rn === undefined) return false;
  if (rn > ra) return true;
  if (rn < ra) return false;
  return (
    !!eventoEn &&
    (!ultimoEventoEn || eventoEn.getTime() > ultimoEventoEn.getTime())
  );
}

/** Referencia del checkout: unica, sin datos personales. */
export function nuevaReferencia(pagoId: string): string {
  return `tp_${pagoId.replace(/-/g, '')}`;
}
