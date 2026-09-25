import type { Vehiculo } from '@/lib/api-client';

/** "abc 12-3" -> "ABC123" (la misma regla que el backend). */
export function normalizarPlaca(placa: string): string {
  return placa.toUpperCase().replace(/[\s-]/g, '');
}

export function describirVehiculo(
  v: Pick<Vehiculo, 'marca' | 'modelo' | 'placa'> & { anio?: number },
): string {
  return `${v.marca} ${v.modelo}${v.anio ? ` ${v.anio}` : ''} · ${v.placa}`;
}
