export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

async function apiFetch<T>(path: string): Promise<T> {
  const token = import.meta.env.VITE_DEV_TOKEN;

  const response = await fetch(`${BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  const body = await response.json().catch(() => undefined);

  if (!response.ok) {
    const message =
      (body && typeof body === 'object' && 'message' in body
        ? String((body as { message: unknown }).message)
        : undefined) ?? `Error ${response.status} llamando a ${path}`;
    throw new ApiError(message, response.status, body);
  }

  return body as T;
}

export interface RangoTiempo {
  inicio: string;
  fin: string;
}

export interface BahiaResumen {
  id: string;
  nombre: string;
}

export interface ServicioResumen {
  id: string;
  nombre: string;
  categoria: 'mecanica' | 'electrica' | 'latoneria';
  duracionMinutos: number;
}

export interface TurnoAgenda {
  id: string;
  bahiaId: string;
  servicioId: string;
  tecnicoId: string;
  usuarioId: string;
  rangoTiempo: RangoTiempo;
  bahia?: BahiaResumen;
  servicio?: ServicioResumen;
}

export function getAgenda(
  tecnicoId: string,
  fecha: string,
): Promise<TurnoAgenda[]> {
  const query = fecha ? `?date=${encodeURIComponent(fecha)}` : '';
  return apiFetch<TurnoAgenda[]>(`/technicians/${tecnicoId}/agenda${query}`);
}
