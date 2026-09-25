import { ApiError } from '@/lib/api-client';

export function mensajeError(error: unknown, porDefecto: string): string {
  return error instanceof ApiError ? error.message : porDefecto;
}

/** Select nativo con el mismo aspecto que Input. */
export const CLASE_SELECT =
  'h-8 w-full rounded-lg border border-input bg-card px-2 text-sm dark:bg-input/30';
