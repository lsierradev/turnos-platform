import type { Page, Route } from '@playwright/test';

/**
 * API simulada para las capturas de regresion visual (Sprint 19).
 *
 * Las capturas no pueden depender de la base: cualquier turno nuevo, un
 * dia distinto o un dato de otra corrida cambiaria los pixeles sin que la
 * interfaz haya cambiado. Aca todo es fijo y relativo a HOY, y el reloj del
 * navegador se congela en AHORA (ver fixtures.ts).
 */

export const HOY = '2026-09-24'; // jueves
export const AHORA = new Date('2026-09-24T14:30:00-05:00');

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const B = ['b1b1b1b1-0000-4000-8000-000000000001', 'b1b1b1b1-0000-4000-8000-000000000002', 'b1b1b1b1-0000-4000-8000-000000000003'];
const S = ['5e5e5e5e-0000-4000-8000-000000000001', '5e5e5e5e-0000-4000-8000-000000000002', '5e5e5e5e-0000-4000-8000-000000000003'];
export const IDS = { tecnico: T1, bahia: B[0], servicio: S[0] };

// Sprint 20: el personal lleva su taller en el token.
const TALLER = { id: '7a7a7a7a-0000-4000-8000-000000000001', nombre: 'Taller Centro', slug: 'centro', activo: true };
const USUARIOS = {
  admin: { sub: 'aaaaaaaa-0000-4000-8000-000000000001', email: 'admin@taller.dev', rol: 'admin', taller: TALLER.id },
  tecnico: { sub: T1, email: 'carlos@taller.dev', rol: 'tecnico', taller: TALLER.id },
  cliente: { sub: 'cccccccc-0000-4000-8000-000000000001', email: 'maria@correo.com', rol: 'cliente', taller: null },
  superadmin: { sub: '5a5a5a5a-0000-4000-8000-000000000001', email: 'soporte@turnopro.dev', rol: 'superadmin', taller: null },
} as const;
export type Rol = keyof typeof USUARIOS;

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** JWT de mentira: el front solo lee el payload, no verifica la firma. */
export function tokenDe(rol: Rol): string {
  return `${b64({ alg: 'none' })}.${b64({ ...USUARIOS[rol], exp: 4102444800 })}.x`;
}

const TECNICOS = [
  { id: T1, nombre: 'Carlos Rojas', email: 'carlos@taller.dev', rol: 'tecnico' },
  { id: T2, nombre: 'Diana Perez', email: 'diana@taller.dev', rol: 'tecnico' },
];
const BAHIAS = [
  { id: B[0], nombre: 'Bahia 1' },
  { id: B[1], nombre: 'Bahia 2' },
  { id: B[2], nombre: 'Bahia 3' },
];
const SERVICIOS = [
  { id: S[0], nombre: 'Cambio de aceite', categoria: 'mecanica', duracionMinutos: 30, precio: '80000.00', activo: true },
  { id: S[1], nombre: 'Diagnostico electrico', categoria: 'electrica', duracionMinutos: 60, precio: '120000.00', activo: true },
  { id: S[2], nombre: 'Latoneria menor', categoria: 'latoneria', duracionMinutos: 120, precio: '250000.00', activo: true },
];
const CLIENTES = [
  { id: 'cccccccc-0000-4000-8000-000000000001', nombre: 'Maria Gomez', email: 'maria@correo.com', rol: 'cliente', telefono: '+57 300 555 0101', ciudad: 'Bogota' },
  { id: 'cccccccc-0000-4000-8000-000000000002', nombre: 'Jorge Diaz', email: 'jorge@correo.com', rol: 'cliente', telefono: null, ciudad: 'Chia' },
];

const instante = (fecha: string, hhmm: string) => new Date(`${fecha}T${hhmm}:00-05:00`).toISOString();
const masMin = (iso: string, min: number) => new Date(Date.parse(iso) + min * 60_000).toISOString();
const sumarDias = (fecha: string, n: number) => {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const diasEntre = (desde: string, hasta: string) => {
  const dias: string[] = [];
  for (let f = desde; f <= hasta; f = sumarDias(f, 1)) dias.push(f);
  return dias;
};
/** Numero estable a partir de una fecha: variacion sin azar. */
const semilla = (fecha: string) => Number(fecha.slice(8, 10)) + Number(fecha.slice(5, 7)) * 3;

// Turnos del tecnico T1 por dia: el mismo patron desplazado.
function agenda(fecha: string) {
  const dow = new Date(`${fecha}T12:00:00Z`).getUTCDay();
  if (dow === 0) return [];
  const plan: [string, number, number, string][] =
    fecha === HOY
      ? [
          ['08:00', 0, 0, 'atendido'],
          ['09:00', 1, 1, 'atendido'],
          ['11:00', 2, 2, 'programado'],
          ['15:00', 0, 0, 'programado'],
          ['16:00', 1, 1, 'cancelado'],
        ]
      : [
          ['08:30', semilla(fecha) % 3, 0, fecha < HOY ? 'atendido' : 'programado'],
          ['13:00', (semilla(fecha) + 1) % 3, 1, fecha < HOY ? 'no_asistio' : 'programado'],
        ];
  return plan.map(([hora, s, b, estado], i) => {
    const servicio = SERVICIOS[s];
    const inicio = instante(fecha, hora);
    return {
      id: `${fecha}-${i}`,
      bahiaId: BAHIAS[b].id,
      servicioId: servicio.id,
      tecnicoId: T1,
      usuarioId: CLIENTES[i % 2].id,
      estado,
      rangoTiempo: { inicio, fin: masMin(inicio, servicio.duracionMinutos) },
      bahia: BAHIAS[b],
      servicio,
    };
  });
}

function nivel(o: number) {
  return o >= 1 ? 'completa' : o >= 0.8 ? 'alta' : o > 0 ? 'normal' : 'libre';
}

function carga(desde: string, hasta: string) {
  const dias = diasEntre(desde, hasta);
  const bahias = BAHIAS.map((b, i) => ({
    bahiaId: b.id,
    nombre: b.nombre,
    dias: dias.map((fecha) => {
      const base = [0.85, 0.45, 1][i];
      const o = new Date(`${fecha}T12:00:00Z`).getUTCDay() === 0 ? 0 : Math.min(1, Math.round((base - ((semilla(fecha) + i) % 4) * 0.1) * 100) / 100);
      const minutos = Math.round(o * 600);
      return { fecha, turnos: Math.round(minutos / 45), minutosOcupados: minutos, ocupacion: o, nivel: nivel(o) };
    }),
  }));
  const resumen = dias.map((fecha, d) => {
    const del = bahias.map((b) => b.dias[d]);
    const min = del.reduce((n, x) => n + x.minutosOcupados, 0);
    return {
      fecha,
      turnos: del.reduce((n, x) => n + x.turnos, 0),
      minutosOcupados: min,
      ocupacion: Math.round((min / 1800) * 1000) / 1000,
      bahiasEnAlerta: del.filter((x) => x.nivel === 'alta' || x.nivel === 'completa').length,
    };
  });
  return {
    desde,
    hasta,
    zonaHoraria: 'America/Bogota',
    jornada: { apertura: '08:00', cierre: '18:00', minutos: 600 },
    umbrales: { alta: 0.8, completa: 1 },
    bahias,
    resumen,
  };
}

function turnosBahia(bahiaId: string, fecha: string) {
  const bahia = BAHIAS.find((b) => b.id === bahiaId) ?? BAHIAS[0];
  return {
    bahia: { ...bahia, activa: true },
    fecha,
    turnos: agenda(fecha).map((t, i) => ({
      id: t.id,
      inicio: t.rangoTiempo.inicio,
      fin: t.rangoTiempo.fin,
      estado: t.estado,
      servicio: { nombre: t.servicio.nombre, categoria: t.servicio.categoria },
      tecnico: { id: T1, nombre: 'Carlos Rojas' },
      clienteNombre: CLIENTES[i % 2].nombre,
    })),
  };
}

function kpis(from: string, to: string, tecnicoId: string | null) {
  const serieDe = (dias: string[], ajuste: number) =>
    dias.map((fecha) => {
      const s = semilla(fecha) + ajuste;
      const domingo = new Date(`${fecha}T12:00:00Z`).getUTCDay() === 0;
      const atendidos = domingo ? 0 : 3 + (s % 4);
      const noAsistio = domingo ? 0 : s % 3 === 0 ? 1 : 0;
      const cancelados = domingo ? 0 : s % 2;
      const programados = fecha >= HOY && !domingo ? 2 : 0;
      return {
        fecha,
        atendidos,
        noAsistio,
        cancelados,
        programados,
        turnosMedidos: atendidos,
        tasaAsistencia: atendidos + noAsistio === 0 ? null : atendidos / (atendidos + noAsistio),
        minutosPromedioServicio: atendidos === 0 ? null : 35 + (s % 5) * 3,
      };
    });
  const resumir = (serie: ReturnType<typeof serieDe>) => {
    const suma = (k: 'atendidos' | 'noAsistio' | 'cancelados' | 'programados' | 'turnosMedidos') =>
      serie.reduce((n, d) => n + d[k], 0);
    const at = suma('atendidos');
    const na = suma('noAsistio');
    const med = serie.filter((d) => d.minutosPromedioServicio !== null);
    return {
      turnosTotales: at + na + suma('cancelados') + suma('programados'),
      turnosAtendidos: at,
      turnosNoAsistio: na,
      turnosCancelados: suma('cancelados'),
      turnosProgramados: suma('programados'),
      turnosMedidos: suma('turnosMedidos'),
      tasaAsistencia: at + na === 0 ? null : at / (at + na),
      minutosPromedioServicio: med.length
        ? Math.round((med.reduce((n, d) => n + d.minutosPromedioServicio! * d.turnosMedidos, 0) / suma('turnosMedidos')) * 10) / 10
        : null,
    };
  };
  const dias = diasEntre(from, to);
  const previos = diasEntre(sumarDias(from, -dias.length), sumarDias(from, -1));
  const serie = serieDe(dias, tecnicoId ? 1 : 0);
  return {
    rango: { from, to },
    zonaHoraria: 'America/Bogota',
    tecnicoId,
    resumen: resumir(serie),
    serie,
    anterior: { rango: { from: previos[0], to: previos.at(-1) }, resumen: resumir(serieDe(previos, 2)) },
  };
}

function disponibilidad(fecha: string) {
  const ocupados = new Set(['09:00', '09:15', '09:30', '11:00', '11:15', '11:30', '11:45', '15:00']);
  const horarios = [];
  for (let m = 8 * 60; m + 30 <= 18 * 60; m += 15) {
    const hhmm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    if (ocupados.has(hhmm)) continue;
    const inicio = instante(fecha, hhmm);
    horarios.push({ inicio, fin: masMin(inicio, 30) });
  }
  return { fecha, zonaHoraria: 'America/Bogota', duracionMinutos: 30, jornada: { apertura: '08:00', cierre: '18:00' }, horarios };
}

function misTurnos() {
  const t = (fecha: string, hora: string, s: number, b: number, estado: string, i: number) => {
    const inicio = instante(fecha, hora);
    return {
      id: `mio-${i}`,
      inicio,
      fin: masMin(inicio, SERVICIOS[s].duracionMinutos),
      estado,
      bahia: BAHIAS[b].nombre,
      servicio: { nombre: SERVICIOS[s].nombre, categoria: SERVICIOS[s].categoria },
      tecnico: 'Carlos Rojas',
      taller: { id: TALLER.id, nombre: TALLER.nombre },
    };
  };
  return [
    t(sumarDias(HOY, 6), '10:00', 1, 1, 'programado', 1),
    t(sumarDias(HOY, 2), '08:30', 0, 0, 'programado', 2),
    t(sumarDias(HOY, -12), '15:00', 2, 2, 'atendido', 3),
    t(sumarDias(HOY, -30), '09:00', 0, 0, 'cancelado', 4),
  ];
}

/** Engancha la API simulada a la pagina. */
export async function simularApi(page: Page, rol: Rol | null): Promise<void> {
  const responder = (route: Route, json: unknown, status = 200) => route.fulfill({ status, json });

  await page.route(/localhost:300[12]\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const q = (k: string) => url.searchParams.get(k);
    const ruta = url.pathname;

    if (req.method() === 'POST') {
      if (ruta === '/auth/login') return responder(route, { accessToken: tokenDe(rol ?? 'admin'), refreshToken: 'r' });
      if (ruta === '/auth/olvide') return route.fulfill({ status: 202 });
      return responder(route, { message: 'No simulado' }, 501);
    }
    if (ruta === '/talleres')
      return responder(
        route,
        rol === 'superadmin'
          ? [TALLER, { id: '7a7a7a7a-0000-4000-8000-000000000002', nombre: 'Taller Norte', slug: 'norte', activo: false }]
          : [TALLER],
      );
    if (ruta === '/bahias') return responder(route, BAHIAS);
    if (ruta === '/servicios') return responder(route, SERVICIOS);
    if (ruta === '/technicians') return responder(route, TECNICOS.map(({ id, nombre }) => ({ id, nombre })));
    if (ruta === '/usuarios') return responder(route, q('rol') === 'cliente' ? CLIENTES : TECNICOS);
    if (ruta === '/appointments/disponibilidad') return responder(route, disponibilidad(q('fecha') ?? HOY));
    if (ruta === '/appointments/mios') return responder(route, misTurnos());
    if (/^\/technicians\/[^/]+\/agenda$/.test(ruta)) return responder(route, agenda(q('date') ?? HOY));
    if (ruta === '/bahias/carga') return responder(route, carga(q('desde') ?? HOY, q('hasta') ?? HOY));
    const detalle = ruta.match(/^\/bahias\/([^/]+)\/turnos$/);
    if (detalle) return responder(route, turnosBahia(detalle[1], q('fecha') ?? HOY));
    if (ruta === '/dashboard/kpis') {
      const tecnico = rol === 'tecnico' ? T1 : q('tecnicoId');
      return responder(route, kpis(q('from') ?? HOY, q('to') ?? HOY, tecnico));
    }
    return responder(route, { message: `No simulado: ${ruta}` }, 404);
  });
}
