import type { EstadoPago, EstadoReembolso } from '@/lib/api-client';

/** Etiqueta y tono de cada estado de un pago (Sprint 24). */
export const ESTADO_PAGO: Record<
  EstadoPago,
  { texto: string; variante: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  creado: { texto: 'Sin completar', variante: 'outline' },
  pendiente: { texto: 'En proceso', variante: 'secondary' },
  aprobado: { texto: 'Aprobado', variante: 'default' },
  rechazado: { texto: 'Rechazado', variante: 'destructive' },
  error: { texto: 'Con error', variante: 'destructive' },
  anulado: { texto: 'Anulado', variante: 'outline' },
  expirado: { texto: 'Vencido', variante: 'outline' },
  en_disputa: { texto: 'En disputa', variante: 'destructive' },
  revertido: { texto: 'Revertido', variante: 'destructive' },
};

export const ESTADO_REEMBOLSO: Record<EstadoReembolso, string> = {
  por_anular: 'Devolucion en curso',
  solicitado: 'Devolucion pedida a Wompi',
  pendiente_manual: 'Devolucion pendiente (a mano)',
  completado: 'Devuelto',
};

export const MOTIVO_REEMBOLSO: Record<string, string> = {
  cancelacion_en_ventana: 'Cancelo a tiempo',
  cancelacion_taller: 'Cancelo el taller',
  turno_liberado: 'Llego tarde: el turno ya no estaba',
  pago_duplicado: 'Pago de mas',
};

/** Tipo de medio de Wompi o del mostrador, en palabras. */
export function nombreMedio(metodo: string | null): string {
  switch (metodo) {
    case 'CARD':
      return 'Tarjeta';
    case 'PSE':
      return 'PSE';
    case 'NEQUI':
      return 'Nequi';
    case 'BANCOLOMBIA_TRANSFER':
      return 'Bancolombia';
    case 'BANCOLOMBIA_QR':
      return 'QR Bancolombia';
    case 'efectivo':
      return 'Efectivo';
    case 'datafono':
      return 'Datafono';
    case 'transferencia':
      return 'Transferencia';
    case 'wompi':
    case null:
      return 'En linea';
    default:
      return metodo;
  }
}
