import type { EstadoOrdenVenta, MedioPagoVenta } from '@/lib/api-client';

/** Etiqueta y tono de cada estado de una orden de venta (Sprint 26). */
export const ESTADO_VENTA: Record<
  EstadoOrdenVenta,
  { texto: string; variante: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  borrador: { texto: 'Borrador', variante: 'outline' },
  confirmada: { texto: 'Confirmada', variante: 'secondary' },
  pagada: { texto: 'Pagada', variante: 'default' },
  anulada: { texto: 'Anulada', variante: 'destructive' },
};

export const MEDIO_PAGO_VENTA_LABEL: Record<MedioPagoVenta, string> = {
  efectivo: 'Efectivo',
  datafono: 'Datafono',
  transferencia: 'Transferencia',
  wompi: 'En linea',
  otro: 'Otro',
};
