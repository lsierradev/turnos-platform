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

/*
 * Taller elegido (Sprint 20): el cliente elige donde reservar y el
 * superadmin en que taller opera. Va en el encabezado X-Taller de cada
 * request. Al personal (admin, tecnico) el backend le ignora el encabezado:
 * usa el taller de su token. Se recuerda entre sesiones del mismo
 * navegador; al salir se olvida.
 */
const CLAVE_TALLER = 'turnos.taller';

function leerTallerElegido(): string | null {
  try {
    return localStorage.getItem(CLAVE_TALLER);
  } catch {
    return null;
  }
}

let tallerElegido: string | null = leerTallerElegido();

export function obtenerTallerElegido(): string | null {
  return tallerElegido;
}

export function establecerTallerElegido(id: string | null): void {
  tallerElegido = id;
  try {
    if (id) localStorage.setItem(CLAVE_TALLER, id);
    else localStorage.removeItem(CLAVE_TALLER);
  } catch {
    // Almacenamiento bloqueado: vale para esta pestana.
  }
}

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
  establecerTallerElegido(null);
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

interface Envio {
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
}

interface Extra {
  /**
   * Taller de ESTE request en vez del elegido (Sprint 22): el cliente ve en
   * "Mis turnos" turnos de varios talleres, y cancelar o aceptar uno se
   * hace en el taller de ese turno.
   */
  taller?: string;
  /** La respuesta es un archivo (fotos de la recepcion), no JSON. */
  blob?: boolean;
}

async function apiFetch<T>(
  path: string,
  reintentando = false,
  base = BASE_URL,
  envio?: Envio,
  extra: Extra = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (tokens) headers.Authorization = `Bearer ${tokens.accessToken}`;
  const taller = extra.taller ?? tallerElegido;
  if (taller) headers['X-Taller'] = taller;
  if (envio?.body !== undefined) headers['Content-Type'] = 'application/json';

  let respuesta: Response;
  try {
    respuesta = await fetch(`${base}${path}`, {
      method: envio?.method ?? 'GET',
      headers,
      body: envio?.body !== undefined ? JSON.stringify(envio.body) : undefined,
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
      // Reintentar un POST es seguro solo porque el 401 lo corta el guard
      // ANTES de llegar al servicio: la primera request no creo nada.
      return apiFetch<T>(path, true, base, envio, extra);
    }
  }

  if (extra.blob && respuesta.ok) return (await respuesta.blob()) as T;

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
  /** Sprint 22: la atencion registrada por el tecnico. */
  atencionInicio?: string | null;
  atencionFin?: string | null;
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
  /** false: dado de baja (Sprint 21). */
  activo: boolean;
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
    /** Horario del taller ese dia (Sprint 21); null si no atiende. */
    jornada: { apertura: string; cierre: string; minutos: number } | null;
    /** "Cerrado" o el motivo del festivo. */
    cerrado: string | null;
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
  zonaHoraria: string;
  /** null = el taller entero. */
  tecnicoId: string | null;
  resumen: KpisResumen;
  serie: KpiDia[];
  /** Periodo anterior de igual largo (Sprint 18), para comparar. */
  anterior: { rango: { from: string; to: string }; resumen: KpisResumen };
}

/**
 * @param tecnicoId admin: filtra por ese tecnico. Para un tecnico el backend
 *   lo ignora y devuelve siempre los suyos.
 */
export function getKpis(from: string, to: string, tecnicoId?: string): Promise<KpisResponse> {
  const query = new URLSearchParams(tecnicoId ? { from, to, tecnicoId } : { from, to }).toString();
  return apiFetch<KpisResponse>(`/dashboard/kpis?${query}`);
}

// --- Mis turnos (Sprint 18) --------------------------------------------

export interface MiTurno {
  id: string;
  inicio: string;
  fin: string;
  estado: TurnoAgenda['estado'];
  bahia: string;
  servicio: { nombre: string; categoria: ServicioResumen['categoria'] };
  tecnico: string | null;
  /** Un cliente puede reservar en varios talleres (Sprint 20). */
  taller: { id: string; nombre: string } | null;
  /** Precio con el que se reservo (Sprint 21); null en turnos anteriores. */
  precio: Precio | null;
  /** Sprint 22: lo que se paga por adelantado (100% con 3 strikes). */
  anticipo: { centavos: number; porStrikes: boolean } | null;
  vehiculo: { id: string; placa: string; marca: string; modelo: string } | null;
  canceladoPor: 'cliente' | 'taller' | null;
  /** Solo si se puede cancelar: hasta cuando es gratis (instante). */
  cancelacion: { gratisHasta: string; ventanaHoras: number } | null;
  recepcion: { id: string; numero: number; aceptada: boolean } | null;
  /** Atendido: termino de garantia (dias null = rige la legal). */
  garantia: { dias: number | null; hasta: string | null } | null;
  /** Para reprogramar con la misma bahia, servicio y tecnico. */
  ids: { bahia: string; servicio: string; tecnico: string | null };
}

/** Los turnos de quien esta logueado: proximos y ultimos 90 dias. */
export function getMisTurnos(): Promise<MiTurno[]> {
  return apiFetch<MiTurno[]>('/appointments/mios');
}

// --- Reserva (Sprint 17) -----------------------------------------------

export interface Opcion {
  id: string;
  nombre: string;
}

/** Bahias en servicio (cualquier autenticado). */
export function getBahias(): Promise<Opcion[]> {
  return apiFetch<Opcion[]>('/bahias');
}

/**
 * Precio en centavos (Sprint 21). tarifaIva null: el taller no es
 * responsable de IVA (no se suma ni se muestra la leyenda).
 */
export interface Precio {
  baseCentavos: number;
  ivaCentavos: number;
  totalCentavos: number;
  tarifaIva: number | null;
}

export type TarifaIva = 0 | 5 | 19;

export interface Servicio extends ServicioResumen {
  precioBaseCentavos: number;
  tarifaIva: TarifaIva;
  requiereAnticipo: boolean;
  porcentajeAnticipo: number | null;
  /** Termino de garantia en dias (Sprint 22); null = rige la legal. */
  garantiaDias: number | null;
  activo: boolean;
  /** Calculado por el backend con la configuracion fiscal del taller. */
  precio: Precio;
  anticipo: { porcentaje: number; centavos: number } | null;
}

export function getServicios(): Promise<Servicio[]> {
  return apiFetch<Servicio[]>('/servicios');
}

/**
 * Tecnicos para reservar: id y nombre, desde reservas-service. No es
 * getTecnicos() (usuarios-service, solo admin, trae email).
 */
export function getTecnicosReservables(): Promise<Opcion[]> {
  return apiFetch<Opcion[]>('/technicians');
}

export interface DisponibilidadParams {
  bahiaId: string;
  servicioId: string;
  tecnicoId: string;
  fecha: string;
  /** Solo admin: descontar los turnos de ese cliente en vez de los propios. */
  clienteId?: string;
}

export interface DisponibilidadResponse {
  fecha: string;
  zonaHoraria: string;
  duracionMinutos: number;
  /** null: el taller no atiende ese dia (Sprint 21). */
  jornada: { apertura: string; cierre: string } | null;
  /** "Cerrado" o el motivo del festivo. */
  cerrado: string | null;
  horarios: RangoTiempo[];
}

export function getDisponibilidad(
  params: DisponibilidadParams,
): Promise<DisponibilidadResponse> {
  const { clienteId, ...resto } = params;
  const query = new URLSearchParams(clienteId ? { ...resto, clienteId } : resto).toString();
  return apiFetch<DisponibilidadResponse>(`/appointments/disponibilidad?${query}`);
}

export interface NuevoTurno {
  bahiaId: string;
  servicioId: string;
  tecnicoId: string;
  /** Instante ISO (UTC). El fin lo calcula el servidor. */
  inicio: string;
  /** Solo admin: a nombre de que cliente (si falta, de quien reserva). */
  clienteId?: string;
  /** Sprint 22: el vehiculo del titular que trae al turno. */
  vehiculoId?: string;
}

export interface TurnoCreado {
  id: string;
  bahiaId: string;
  servicioId: string;
  tecnicoId: string;
  usuarioId: string;
  estado: TurnoAgenda['estado'];
  rangoTiempo: RangoTiempo;
  /** Foto del precio al reservar (Sprint 21). */
  precioBaseCentavos: number | null;
  ivaCentavos: number | null;
  totalCentavos: number | null;
  tarifaIva: number | null;
  /** Sprint 22: con 3 strikes, anticipo = total (pago 100% por adelantado). */
  anticipoCentavos: number | null;
  anticipoPorStrikes: boolean;
}

export function crearTurno(turno: NuevoTurno): Promise<TurnoCreado> {
  return apiFetch<TurnoCreado>('/appointments', false, BASE_URL, {
    method: 'POST',
    body: turno,
  });
}

/**
 * Sugerencias del 409 de POST /appointments (UX-NOTES punto 8). El cuerpo
 * viene entero en ApiError.body; esto lo valida en vez de confiar en la
 * forma.
 */
export function sugerenciasDeConflicto(error: unknown): RangoTiempo[] | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const body = error.body as { sugerencias?: unknown } | undefined;
  // Un 409 sin sugerencias no es un choque de horario (p. ej. un correo
  // repetido al dar de alta un cliente).
  if (!Array.isArray(body?.sugerencias)) return null;
  return body.sugerencias.filter(
    (s): s is RangoTiempo =>
      typeof s?.inicio === 'string' && typeof s?.fin === 'string',
  );
}

// --- Clientes (usuarios-service, solo admin; Sprint 17) ------------------

export interface Cliente {
  id: string;
  email: string;
  nombre: string;
  rol: 'cliente';
  /** Descifrado por usuarios-service (se guarda cifrado). */
  telefono: string | null;
  ciudad: string | null;
  /**
   * Solo en la respuesta del alta (Sprint 18): si salio el correo para que
   * defina su contrasena. false = SendGrid sin configurar (quedo en el log).
   */
  invitacion?: { enviado: boolean };
}

export function getClientes(): Promise<Cliente[]> {
  return apiFetch<Cliente[]>('/usuarios?rol=cliente', false, AUTH_URL);
}

export interface DatosClienteNuevo {
  nombre: string;
  email: string;
  telefono?: string;
  ciudad: string;
}

/**
 * Alta de un cliente con sus datos de perfil. Sin contrasena: usuarios-
 * service le asigna una al azar que nadie conoce, asi que la cuenta todavia
 * no sirve para entrar.
 */
export function crearCliente(datos: DatosClienteNuevo): Promise<Cliente> {
  return apiFetch<Cliente>('/usuarios', false, AUTH_URL, {
    method: 'POST',
    body: { ...datos, rol: 'cliente' },
  });
}

// --- Contrasena (usuarios-service, publicos; Sprint 18) -------------------

/** "Olvide mi contrasena". Responde igual exista o no el correo. */
export function solicitarRestablecimiento(email: string): Promise<void> {
  return apiFetch<void>('/auth/olvide', false, AUTH_URL, {
    method: 'POST',
    body: { email },
  });
}

/** Define la contrasena con el token del enlace que llego por correo. */
export function restablecerContrasena(token: string, password: string): Promise<void> {
  return apiFetch<void>('/auth/restablecer', false, AUTH_URL, {
    method: 'POST',
    body: { token, password },
  });
}

// --- Talleres (usuarios-service, Sprint 20) ------------------------------

export interface Taller {
  id: string;
  nombre: string;
  slug: string;
  activo: boolean;
}

/** Los que el usuario puede ver: activos, el propio y (superadmin) todos. */
export function getTalleres(): Promise<Taller[]> {
  return apiFetch<Taller[]>('/talleres', false, AUTH_URL);
}

export interface NuevoTaller {
  nombre: string;
  slug: string;
  admin: { nombre: string; email: string };
}

export interface TallerCreado {
  taller: Taller;
  admin: { id: string; email: string; nombre: string };
  invitacion: { enviado: boolean };
}

export function crearTaller(datos: NuevoTaller): Promise<TallerCreado> {
  return apiFetch<TallerCreado>('/talleres', false, AUTH_URL, { method: 'POST', body: datos });
}

export function actualizarTaller(
  id: string,
  cambios: Partial<Pick<Taller, 'nombre' | 'activo'>>,
): Promise<Taller> {
  return apiFetch<Taller>(`/talleres/${id}`, false, AUTH_URL, { method: 'PATCH', body: cambios });
}

// --- Mi taller (Sprint 21) ---------------------------------------------

export interface DatosServicio {
  nombre: string;
  categoria: ServicioResumen['categoria'];
  duracionMinutos: number;
  precioBaseCentavos: number;
  tarifaIva: TarifaIva;
  requiereAnticipo: boolean;
  porcentajeAnticipo: number | null;
  garantiaDias?: number | null;
  activo?: boolean;
}

export function crearServicio(datos: DatosServicio): Promise<Servicio> {
  return apiFetch<Servicio>('/servicios', false, BASE_URL, { method: 'POST', body: datos });
}

export function actualizarServicio(id: string, cambios: Partial<DatosServicio>): Promise<Servicio> {
  return apiFetch<Servicio>(`/servicios/${id}`, false, BASE_URL, { method: 'PATCH', body: cambios });
}

export function borrarServicio(id: string): Promise<void> {
  return apiFetch<void>(`/servicios/${id}`, false, BASE_URL, { method: 'DELETE' });
}

export interface BahiaCatalogo {
  id: string;
  nombre: string;
  activa: boolean;
}

/** Todas, tambien las fuera de servicio (solo admin). */
export function getBahiasTodas(): Promise<BahiaCatalogo[]> {
  return apiFetch<BahiaCatalogo[]>('/bahias/todas');
}

export function crearBahia(nombre: string): Promise<BahiaCatalogo> {
  return apiFetch<BahiaCatalogo>('/bahias', false, BASE_URL, { method: 'POST', body: { nombre } });
}

export function actualizarBahia(
  id: string,
  cambios: Partial<Pick<BahiaCatalogo, 'nombre' | 'activa'>>,
): Promise<BahiaCatalogo & { turnosPorVenir: number }> {
  return apiFetch(`/bahias/${id}`, false, BASE_URL, { method: 'PATCH', body: cambios });
}

/** Alta de tecnico: le llega el correo para elegir su contrasena. */
export function crearTecnico(datos: { nombre: string; email: string }): Promise<Tecnico> {
  return apiFetch<Tecnico>('/usuarios', false, AUTH_URL, {
    method: 'POST',
    body: { ...datos, rol: 'tecnico' },
  });
}

export function darDeBajaTecnico(id: string): Promise<{ turnosParaReasignar: number }> {
  return apiFetch(`/usuarios/${id}/baja`, false, AUTH_URL, { method: 'POST' });
}

export function reactivarTecnico(id: string): Promise<void> {
  return apiFetch<void>(`/usuarios/${id}/reactivar`, false, AUTH_URL, { method: 'POST' });
}

export interface TurnoSinTecnico {
  id: string;
  inicio: string;
  fin: string;
  bahia: string;
  servicio: string;
  cliente: string | null;
}

export function getTurnosSinTecnico(): Promise<TurnoSinTecnico[]> {
  return apiFetch<TurnoSinTecnico[]>('/appointments/sin-tecnico');
}

export function reasignarTecnico(turnoId: string, tecnicoId: string): Promise<unknown> {
  return apiFetch(`/appointments/${turnoId}/tecnico`, false, BASE_URL, {
    method: 'PATCH',
    body: { tecnicoId },
  });
}

export interface ConfiguracionFiscal {
  razonSocial: string | null;
  nit: string | null;
  dv: number | null;
  direccion: string | null;
  municipio: string | null;
  departamento: string | null;
  responsableIva: boolean;
  completa: boolean;
  facturacion: { proveedor: 'alegra' | 'siigo'; usuario: string; token: string } | null;
  wompi: {
    ambiente: 'pruebas' | 'produccion';
    llavePublica: string;
    llavePrivada: string | null;
    secretoIntegridad: string | null;
    secretoEventos: string | null;
  } | null;
}

export interface DatosFiscales {
  razonSocial: string;
  nit: string;
  dv: number;
  direccion: string;
  municipio: string;
  departamento: string;
  responsableIva: boolean;
}

export function getConfiguracionFiscal(): Promise<ConfiguracionFiscal> {
  return apiFetch<ConfiguracionFiscal>('/configuracion/fiscal');
}

export function guardarDatosFiscales(datos: DatosFiscales): Promise<ConfiguracionFiscal> {
  return apiFetch<ConfiguracionFiscal>('/configuracion/fiscal', false, BASE_URL, {
    method: 'PUT',
    body: datos,
  });
}

/** `validado` false: se guardo sin consultar al proveedor (desarrollo). */
export function guardarFacturacion(datos: {
  proveedor: 'alegra';
  usuario: string;
  token: string;
}): Promise<ConfiguracionFiscal & { validado: boolean }> {
  return apiFetch('/configuracion/facturacion', false, BASE_URL, { method: 'PUT', body: datos });
}

export function guardarWompi(datos: {
  ambiente: 'pruebas' | 'produccion';
  llavePublica: string;
  llavePrivada?: string;
  secretoIntegridad?: string;
  secretoEventos?: string;
}): Promise<ConfiguracionFiscal & { validado: boolean }> {
  return apiFetch('/configuracion/wompi', false, BASE_URL, { method: 'PUT', body: datos });
}

export interface DiaHorario {
  /** ISO: 1 = lunes ... 7 = domingo. */
  dia: number;
  apertura: string;
  cierre: string;
}

export interface Feriado {
  fecha: string;
  motivo: string;
}

export function getHorario(): Promise<{ dias: DiaHorario[]; feriados: Feriado[] }> {
  return apiFetch('/configuracion/horario');
}

export function guardarHorario(dias: DiaHorario[]): Promise<{ turnosFueraDeHorario: number }> {
  return apiFetch('/configuracion/horario', false, BASE_URL, { method: 'PUT', body: { dias } });
}

export function agregarFeriado(feriado: Feriado): Promise<{ turnosFueraDeHorario: number }> {
  return apiFetch('/configuracion/feriados', false, BASE_URL, { method: 'POST', body: feriado });
}

export function eliminarFeriado(fecha: string): Promise<void> {
  return apiFetch<void>(`/configuracion/feriados/${fecha}`, false, BASE_URL, { method: 'DELETE' });
}

export function importarFestivosColombia(
  anio: number,
): Promise<{ agregados: number; turnosFueraDeHorario: number }> {
  return apiFetch('/configuracion/feriados/colombia', false, BASE_URL, {
    method: 'POST',
    body: { anio },
  });
}

// --- Sprint 22: vehiculos, politica de cancelacion, recepcion -------------

export interface Vehiculo {
  id: string;
  usuarioId: string;
  placa: string;
  marca: string;
  modelo: string;
  anio: number;
  kilometraje: number;
  activo: boolean;
}

export interface DatosVehiculo {
  placa: string;
  marca: string;
  modelo: string;
  anio: number;
  kilometraje: number;
}

/** Los propios (cliente) o los de un cliente del taller (personal). */
export function getVehiculos(clienteId?: string): Promise<Vehiculo[]> {
  return apiFetch<Vehiculo[]>(
    clienteId ? `/vehiculos?clienteId=${encodeURIComponent(clienteId)}` : '/vehiculos',
  );
}

export function crearVehiculo(datos: DatosVehiculo & { clienteId?: string }): Promise<Vehiculo> {
  return apiFetch<Vehiculo>('/vehiculos', false, BASE_URL, { method: 'POST', body: datos });
}

export function actualizarVehiculo(id: string, cambios: Partial<DatosVehiculo>): Promise<Vehiculo> {
  return apiFetch<Vehiculo>(`/vehiculos/${id}`, false, BASE_URL, { method: 'PATCH', body: cambios });
}

export function darDeBajaVehiculo(id: string): Promise<void> {
  return apiFetch<void>(`/vehiculos/${id}`, false, BASE_URL, { method: 'DELETE' });
}

export interface Politica {
  ventanaHoras: number;
  vigenciaStrikesMeses: number;
  strikesParaPrepago: number;
}

export interface PoliticaCliente extends Politica {
  strikesVigentes: number;
  /** Con strikesParaPrepago vigentes: reserva pagando el 100%. */
  requierePrepago: boolean;
}

/** La politica del taller elegido y como esta el cliente ahi. */
export function getPolitica(clienteId?: string): Promise<PoliticaCliente> {
  return apiFetch<PoliticaCliente>(
    clienteId ? `/politica?clienteId=${encodeURIComponent(clienteId)}` : '/politica',
  );
}

export function guardarPolitica(datos: {
  ventanaHoras: number;
  vigenciaStrikesMeses: number;
}): Promise<Politica> {
  return apiFetch<Politica>('/politica', false, BASE_URL, { method: 'PUT', body: datos });
}

export type MotivoStrike = 'cancelacion_tardia' | 'reprogramacion_tardia' | 'no_asistio';

export interface Strike {
  id: string;
  motivo: MotivoStrike;
  detalle: string;
  creadoEn: string;
  venceEn: string;
  estado: 'vigente' | 'vencido' | 'anulado';
  anulacion: { en: string; justificacion: string } | null;
  turno: { id: string; inicio: string; servicio: string };
  taller: { id: string; nombre: string };
  cliente?: { id: string; nombre: string; email: string };
  reclamo: {
    texto: string;
    creadoEn: string;
    resultado: 'aceptado' | 'rechazado' | null;
    respuesta: string | null;
    resueltoEn: string | null;
  } | null;
}

export function getMisStrikes(): Promise<Strike[]> {
  return apiFetch<Strike[]>('/strikes/mios');
}

export function reclamarStrike(id: string, texto: string): Promise<Strike> {
  return apiFetch<Strike>(`/strikes/${id}/reclamo`, false, BASE_URL, {
    method: 'POST',
    body: { texto },
  });
}

export function getStrikesTaller(estado: 'reclamos' | 'vigentes' | 'todos'): Promise<Strike[]> {
  return apiFetch<Strike[]>(`/strikes?estado=${estado}`);
}

export function anularStrike(id: string, justificacion: string): Promise<Strike> {
  return apiFetch<Strike>(`/strikes/${id}/anular`, false, BASE_URL, {
    method: 'POST',
    body: { justificacion },
  });
}

export function resolverReclamo(id: string, aceptar: boolean, respuesta: string): Promise<Strike> {
  return apiFetch<Strike>(`/strikes/${id}/reclamo/resolver`, false, BASE_URL, {
    method: 'POST',
    body: { aceptar, respuesta },
  });
}

/** Lo que devuelven cancelar y reprogramar. */
export interface ResultadoCambio {
  /** Cancelar: el turno cancelado. Reprogramar: el turno nuevo. */
  turno: TurnoCreado;
  /** Se sumo un strike (fuera de la ventana). */
  strike: boolean;
  gratisHasta: string;
}

/**
 * @param taller el del turno: el cliente puede estar mirando otro.
 * @param solicitadoPor solo personal: si lo pidio el cliente (strike fuera
 *   de la ventana) o lo decidio el taller (nunca strike).
 */
export function cancelarTurno(
  turnoId: string,
  opciones: { taller?: string; motivo?: string; solicitadoPor?: 'cliente' | 'taller' } = {},
): Promise<ResultadoCambio> {
  const { taller, ...body } = opciones;
  return apiFetch<ResultadoCambio>(
    `/appointments/${turnoId}/cancelar`,
    false,
    BASE_URL,
    { method: 'POST', body },
    { taller },
  );
}

export function reprogramarTurno(
  turnoId: string,
  datos: { inicio: string; bahiaId?: string; tecnicoId?: string },
  taller?: string,
): Promise<ResultadoCambio> {
  return apiFetch<ResultadoCambio>(
    `/appointments/${turnoId}/reprogramar`,
    false,
    BASE_URL,
    { method: 'POST', body: datos },
    { taller },
  );
}

export type EstadoTurno = TurnoAgenda['estado'];

export interface OrdenTrabajo {
  numero: number | null;
  taller: {
    id: string;
    nombre: string;
    razonSocial: string | null;
    nit: string | null;
    dv: number | null;
    direccion: string | null;
    municipio: string | null;
  };
  cliente: { id: string; nombre: string; email: string; telefono: string | null } | null;
  turno: {
    id: string;
    inicio: string;
    fin: string;
    estado: EstadoTurno;
    bahia: string;
    servicio: { id: string; nombre: string; categoria: string };
    tecnico: { id: string; nombre: string } | null;
    precio: Precio | null;
    anticipo: { centavos: number; porStrikes: boolean } | null;
    canceladoPor: 'cliente' | 'taller' | null;
    motivoCancelacion: string | null;
  };
  vehiculo: {
    id: string;
    placa: string;
    marca: string;
    modelo: string;
    anio: number;
    kilometraje: number;
  } | null;
  recepcion: {
    id: string;
    numero: number;
    kilometraje: number;
    nivelCombustible: number;
    estadoVehiculo: string;
    objetosDejados: string;
    observaciones: string | null;
    fechaProbableEntrega: string;
    recibidoPor: string | null;
    creadoEn: string;
    aceptacion: {
      en: string;
      medio: 'cuenta' | 'presencial';
      nombre: string | null;
      documento: string | null;
    } | null;
    fotos: { id: string; tipoMime: string }[];
  } | null;
  atencion: { inicio: string | null; fin: string | null; notas: string | null };
  garantia: { dias: number | null; hasta: string | null; texto: string };
}

/** Orden de trabajo del turno: el personal del taller o el titular. */
export function getOrden(turnoId: string, taller?: string): Promise<OrdenTrabajo> {
  return apiFetch<OrdenTrabajo>(`/appointments/${turnoId}/orden`, false, BASE_URL, undefined, {
    taller,
  });
}

export interface DatosRecepcion {
  vehiculoId: string;
  kilometraje: number;
  /** Cuartos de tanque: 0 = reserva ... 4 = lleno. */
  nivelCombustible: number;
  estadoVehiculo: string;
  objetosDejados?: string;
  observaciones?: string;
  fechaProbableEntrega?: string;
}

export function guardarRecepcion(turnoId: string, datos: DatosRecepcion): Promise<OrdenTrabajo> {
  return apiFetch<OrdenTrabajo>(`/appointments/${turnoId}/recepcion`, false, BASE_URL, {
    method: 'PUT',
    body: datos,
  });
}

export function subirFotoRecepcion(
  recepcionId: string,
  foto: { tipoMime: 'image/jpeg' | 'image/png' | 'image/webp'; datos: string },
): Promise<{ id: string; tipoMime: string }> {
  return apiFetch(`/recepciones/${recepcionId}/fotos`, false, BASE_URL, {
    method: 'POST',
    body: foto,
  });
}

export function quitarFotoRecepcion(recepcionId: string, fotoId: string): Promise<void> {
  return apiFetch<void>(`/recepciones/${recepcionId}/fotos/${fotoId}`, false, BASE_URL, {
    method: 'DELETE',
  });
}

/** La foto como Blob: va con el token, no sirve un <img src> directo. */
export function getFotoRecepcion(recepcionId: string, fotoId: string, taller?: string): Promise<Blob> {
  return apiFetch<Blob>(`/recepciones/${recepcionId}/fotos/${fotoId}`, false, BASE_URL, undefined, {
    taller,
    blob: true,
  });
}

/**
 * Aceptar la constancia. El cliente desde su cuenta (sin datos); el
 * personal en el mostrador, con nombre y documento de quien entrega.
 */
export function aceptarRecepcion(
  recepcionId: string,
  datos: { nombre?: string; documento?: string } = {},
  taller?: string,
): Promise<OrdenTrabajo> {
  return apiFetch<OrdenTrabajo>(
    `/recepciones/${recepcionId}/aceptar`,
    false,
    BASE_URL,
    { method: 'POST', body: datos },
    { taller },
  );
}

export function iniciarAtencion(turnoId: string): Promise<unknown> {
  return apiFetch(`/appointments/${turnoId}/atencion/inicio`, false, BASE_URL, { method: 'POST' });
}

export function finalizarAtencion(turnoId: string, notas?: string): Promise<unknown> {
  return apiFetch(`/appointments/${turnoId}/atencion/fin`, false, BASE_URL, {
    method: 'POST',
    body: notas === undefined ? {} : { notas },
  });
}

export function guardarNotas(turnoId: string, notas: string): Promise<unknown> {
  return apiFetch(`/appointments/${turnoId}/notas`, false, BASE_URL, {
    method: 'PATCH',
    body: { notas },
  });
}

/** Cierre: atendido o no asistio (tecnico); el admin tambien cancela o corrige. */
export function cerrarTurno(
  turnoId: string,
  estado: EstadoTurno,
  motivo?: string,
): Promise<unknown> {
  return apiFetch(`/appointments/${turnoId}/estado`, false, BASE_URL, {
    method: 'PATCH',
    body: motivo ? { estado, motivo } : { estado },
  });
}
