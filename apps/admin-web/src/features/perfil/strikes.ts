import type { MotivoStrike, Strike } from '@/lib/api-client';

export const MOTIVO_STRIKE: Record<MotivoStrike, string> = {
  cancelacion_tardia: 'Cancelacion tardia',
  reprogramacion_tardia: 'Reprogramacion tardia',
  no_asistio: 'No asistio',
};

export const ESTADO_STRIKE: Record<
  Strike['estado'],
  { texto: string; variante: 'destructive' | 'secondary' | 'outline' }
> = {
  vigente: { texto: 'Vigente', variante: 'destructive' },
  vencido: { texto: 'Vencido', variante: 'secondary' },
  anulado: { texto: 'Anulado', variante: 'outline' },
};

/** Textarea nativo con el aspecto de Input. */
export const CLASE_TEXTAREA =
  'w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30';
