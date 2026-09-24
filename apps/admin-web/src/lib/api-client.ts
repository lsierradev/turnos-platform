import {
  guardarSesion,
  leerSesion,
  limpiarSesion,
  type Tokens,
} from './sesion';

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
// usuarios-service vive en otro host en producción (auth.dominio), así que
// necesita su propia variable. En local ambos caen en localhost.
const AUTH_URL = import.meta.env.VITE_AUTH_URL ?? 'http://localhost:3002';

// Copia en memoria de los tokens, para no leer sessionStorage en cada
// request. `null` = sin sesión.
let tokens: Tokens | null = leerSesion();

// Callback que el AuthProvider registra para enterarse de que la sesión se
// perdió (refresh vencido) y poder redirigir al login.
let alCerrarSesion: (() => void) | null = null;

export function registrarCierreDeSesion(cb: (() => void) | null): void {
  alCerrarSesion = cb;
}

export function obtenerTokens(): Tokens | null {
  return tokens;
}

export function establecerTokens(nuevos: Tokens | null): void {
  tokens = nuevos;
  if (nuevos) {
    guardarSesion(nuevos);
  } else {
    limpiarSesion();
  }
}

export async function login(
  email: string,
  password: string,
): Promise<Tokens> {
  const respuesta = await fetch(`${AUTH_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const body = await respuesta.json().catch(() => undefined);

  if (!respuesta.ok) {
    throw new ApiError(mensajeDeError(body, respuesta.status), respuesta.status, body);
  }

  const nuevos = body as Tokens;
  establecerTokens(nuevos);
  return nuevos;
}

export function logout(): void {
  establecerTokens(null);
}

/*
 * Renovación del access token.
 *
 * Los access token duran 15 minutos y el dashboard hace polling cada 2
 * segundos, así que cuando uno vence hay varias llamadas en vuelo que van a
 * recibir 401 casi a la vez. Si cada una disparara su propio refresh, se
 * mandarían decenas de refresh simultáneos.
 *
 * `refrescoEnCurso` hace que todas compartan la MISMA promesa: la primera
 * dispara el refresh y el resto espera ese resultado.
 */
let refrescoEnCurso: Promise<string | null> | null = null;

async function refrescarToken(): Promise<string | null> {
  if (refrescoEnCurso) {
    return refrescoEnCurso;
  }

  const refreshToken = tokens?.refreshToken;
  if (!refreshToken) {
    return null;
  }

  refrescoEnCurso = (async () => {
    try {
      const respuesta = await fetch(`${AUTH_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!respuesta.ok) {
        // El refresh token también venció (dura 7 días) o es inválido: no
        // hay forma de recuperar la sesión sin volver a loguearse.
        establecerTokens(null);
        alCerrarSesion?.();
        return null;
      }

      const { accessToken } = (await respuesta.json()) as {
        accessToken: string;
      };
      establecerTokens({ accessToken, refreshToken });
      return accessToken;
    } catch {
      // Un fallo de red NO cierra la sesión: el token puede seguir siendo
      // válido y el problema ser la conexión. Cerrar sesión acá echaría al
      // usuario del panel cada vez que se corta el wifi del taller.
      return null;
    } finally {
      refrescoEnCurso = null;
    }
  })();

  return refrescoEnCurso;
}

function mensajeDeError(body: unknown, status: number): string {
  const delCuerpo =
    body && typeof body === 'object' && 'message' in body
      ? (body as { message: unknown }).message
      : undefined;

  // El ValidationPipe devuelve un array de mensajes; el filtro global del
  // backend lo preserva tal cual.
  if (Array.isArray(delCuerpo)) {
    return delCuerpo.join('. ');
  }
  if (typeof delCuerpo === 'string' && delCuerpo) {
    return delCuerpo;
  }

  // Mensajes propios para los dos casos que el backend no puede explicar
  // mejor que el frontend. Antes un 401 se veía igual que un 404 y quien
  // probaba el panel creía que el dato no existía, cuando en realidad se le
  // había vencido la sesión (hallazgo 3 de UX-NOTES.md).
  if (status === 401) {
    return 'Tu sesión expiró. Volvé a iniciar sesión.';
  }
  if (status === 403) {
    return 'Tu usuario no tiene permiso para ver esto.';
  }
  return `Error ${status}`;
}

/**
 * status 0 = la request ni siquiera llego a tener respuesta (servidor caido,
 * sin red, CORS). fetch() lo reporta como TypeError("Failed to fetch"), que
 * mostrado tal cual no le dice nada a nadie; como ApiError con status 0 la
 * UI lo puede explicar (ver lib/errores.ts).
 */
export const STATUS_SIN_CONEXION = 0;

async function apiFetch<T>(
  path: string,
  reintentando = false,
  base = BASE_URL,
): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await fetch(`${base}${path}`, {
      headers: tokens
        ? { Authorization: `Bearer ${tokens.accessToken}` }
        : undefined,
    });
  } catch (error) {
    throw new ApiError(
      'No se pudo conectar con el servidor.',
      STATUS_SIN_CONEXION,
      error,
    );
  }

  // Un 401 con sesión activa significa access token vencido: se renueva una
  // sola vez y se reintenta. `reintentando` corta la recursión para que un
  // backend que responde 401 siempre no genere un bucle infinito.
  if (respuesta.status === 401 && !reintentando && tokens) {
    const nuevo = await refrescarToken();
    if (nuevo) {
      return apiFetch<T>(path, true, base);
    }
  }

  const body = await respuesta.json().catch(() => undefined);

  if (!respuesta.ok) {
    if (respuesta.status === 401) {
      establecerTokens(null);
      alCerrarSesion?.();
    }
    throw new ApiError(
      mensajeDeError(body, respuesta.status),
      respuesta.status,
      body,
    );
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
  estado: 'programado' | 'atendido' | 'no_asistio' | 'cancelado';
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

export interface Tecnico {
  id: string;
  email: string;
  nombre: string;
  rol: 'tecnico';
}

/** GET /usuarios?rol=tecnico en usuarios-service (solo admin, Sprint 11). */
export function getTecnicos(): Promise<Tecnico[]> {
  return apiFetch<Tecnico[]>('/usuarios?rol=tecnico', false, AUTH_URL);
}

// --- Carga por bahia (Sprint 16) ---------------------------------------

export type NivelOcupacion = 'libre' | 'normal' | 'alta' | 'completa';

export interface CargaDia {
  fecha: string;
  turnos: number;
  minutosOcupados: number;
  /** 0..1 sobre la jornada laboral. */
  ocupacion: number;
  nivel: NivelOcupacion;
}

export interface CargaBahia {
  bahiaId: string;
  nombre: string;
  dias: CargaDia[];
}

export interface CargaResponse {
  desde: string;
  hasta: string;
  zonaHoraria: string;
  jornada: { apertura: string; cierre: string; minutos: number };
  /** Umbrales de alerta, definidos por el backend (0..1). */
  umbrales: { alta: number; completa: number };
  bahias: CargaBahia[];
  resumen: {
    fecha: string;
    turnos: number;
    minutosOcupados: number;
    ocupacion: number;
    bahiasEnAlerta: number;
  }[];
}

export function getCargaBahias(desde: string, hasta: string): Promise<CargaResponse> {
  const query = new URLSearchParams({ desde, hasta }).toString();
  return apiFetch<CargaResponse>(`/bahias/carga?${query}`);
}

export interface TurnoDeBahia {
  id: string;
  inicio: string;
  fin: string;
  estado: 'programado' | 'atendido' | 'no_asistio' | 'cancelado';
  servicio: { nombre: string; categoria: 'mecanica' | 'electrica' | 'latoneria' };
  tecnico: { id: string; nombre: string } | null;
  clienteNombre: string | null;
}

export interface TurnosBahiaResponse {
  bahia: { id: string; nombre: string; activa: boolean };
  fecha: string;
  turnos: TurnoDeBahia[];
}

export function getTurnosBahia(bahiaId: string, fecha: string): Promise<TurnosBahiaResponse> {
  return apiFetch<TurnosBahiaResponse>(
    `/bahias/${bahiaId}/turnos?fecha=${encodeURIComponent(fecha)}`,
  );
}

export interface KpiDia {
  fecha: string;
  atendidos: number;
  noAsistio: number;
  cancelados: number;
  programados: number;
  turnosMedidos: number;
  // null y 0 no son lo mismo: null es "todavia no hay turnos cerrados ese
  // dia", 0 es "no fue nadie". Los graficos cortan la linea en null en vez
  // de dibujar un 0 -- ver DashboardView.
  tasaAsistencia: number | null;
  minutosPromedioServicio: number | null;
}

export interface KpisResumen {
  turnosTotales: number;
  turnosAtendidos: number;
  turnosNoAsistio: number;
  turnosCancelados: number;
  turnosProgramados: number;
  turnosMedidos: number;
  tasaAsistencia: number | null;
  minutosPromedioServicio: number | null;
}

export interface KpisResponse {
  rango: { from: string; to: string };
  resumen: KpisResumen;
  serie: KpiDia[];
}

export function getKpis(from: string, to: string): Promise<KpisResponse> {
  const query = new URLSearchParams({ from, to }).toString();
  return apiFetch<KpisResponse>(`/dashboard/kpis?${query}`);
}
