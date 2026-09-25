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
  { id: T1, nombre: 'Carlos Rojas', email: 'carlos@taller.dev', rol: 'tecnico', activo: true },
  { id: T2, nombre: 'Diana Perez', email: 'diana@taller.dev', rol: 'tecnico', activo: true },
  { id: '33333333-3333-4333-8333-333333333333', nombre: 'Luis Mora', email: 'luis@taller.dev', rol: 'tecnico', activo: false },
];
const BAHIAS = [
  { id: B[0], nombre: 'Bahia 1' },
  { id: B[1], nombre: 'Bahia 2' },
  { id: B[2], nombre: 'Bahia 3' },
];
// Sprint 21: el taller simulado es responsable de IVA; precio base en
// centavos y el calculado, como lo devuelve el backend.
const iva = (base: number) => Math.floor((base * 19 + 50) / 100);
const servicio = (
  id: string,
  nombre: string,
  categoria: string,
  duracionMinutos: number,
  base: number,
  anticipo: number | null = null,
) => ({
  id,
  nombre,
  categoria,
  duracionMinutos,
  precioBaseCentavos: base,
  tarifaIva: 19,
  requiereAnticipo: anticipo !== null,
  porcentajeAnticipo: anticipo,
  activo: true,
  precio: { baseCentavos: base, ivaCentavos: iva(base), totalCentavos: base + iva(base), tarifaIva: 19 },
  anticipo:
    anticipo === null ? null : { porcentaje: anticipo, centavos: Math.floor(((base + iva(base)) * anticipo + 50) / 100) },
});
// Base despejada desde un total redondo, como la carga el admin en modo
// "precio final": el cliente ve $ 80.000, no $ 80.000,13.
const baseDe = (total: number) => Math.round((total * 100) / 119);
const SERVICIOS = [
  servicio(S[0], 'Cambio de aceite', 'mecanica', 30, baseDe(8_000_000)),
  servicio(S[1], 'Diagnostico electrico', 'electrica', 60, baseDe(12_000_000)),
  servicio(S[2], 'Latoneria menor', 'latoneria', 120, baseDe(25_000_000), 20),
];
const FISCAL = {
  razonSocial: 'Taller Centro SAS',
  nit: '900123456',
  dv: 8,
  direccion: 'Calle 45 # 12-30',
  municipio: 'Bogota',
  departamento: 'Cundinamarca',
  responsableIva: true,
  completa: true,
  facturacion: { proveedor: 'alegra', usuario: 'facturas@tallercentro.co', token: '••••a1b2' },
  wompi: {
    ambiente: 'pruebas',
    llavePublica: 'pub_test_Q5yDA9xoKdePzhSGeVe9HAez7HgGORGf',
    llavePrivada: '••••x9Kd',
    secretoIntegridad: '••••7fQw',
    secretoEventos: '••••M2pL',
  },
};
// Lunes a viernes 08:00-18:00, sabado 08:00-13:00, domingo cerrado.
const HORARIO = {
  dias: [
    ...[1, 2, 3, 4, 5].map((dia) => ({ dia, apertura: '08:00', cierre: '18:00' })),
    { dia: 6, apertura: '08:00', cierre: '13:00' },
  ],
  feriados: [
    { fecha: '2026-10-12', motivo: 'Día de la Raza' },
    { fecha: '2026-11-02', motivo: 'Todos los Santos' },
  ],
};
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
    const domingo = new Date(`${fecha}T12:00:00Z`).getUTCDay() === 0;
    return {
      fecha,
      jornada: domingo ? null : { apertura: '08:00', cierre: '18:00', minutos: 600 },
      cerrado: domingo ? 'Cerrado' : null,
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
  return {
    fecha,
    zonaHoraria: 'America/Bogota',
    duracionMinutos: 30,
    jornada: { apertura: '08:00', cierre: '18:00' },
    cerrado: null,
    horarios,
  };
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
      precio: estado === 'cancelado' ? null : SERVICIOS[s].precio,
      // Sprint 22.
      anticipo: null,
      vehiculo: i === 2 || i === 3 ? { id: VEHICULO.id, placa: VEHICULO.placa, marca: VEHICULO.marca, modelo: VEHICULO.modelo } : null,
      canceladoPor: estado === 'cancelado' ? 'cliente' : null,
      cancelacion: estado === 'programado' ? { gratisHasta: masMin(inicio, -4 * 60), ventanaHoras: 4 } : null,
      recepcion: estado === 'atendido' ? { id: 'rec-1', numero: 41, aceptada: true } : null,
      garantia: estado === 'atendido' ? { dias: 90, hasta: sumarDias(fecha, 90) } : null,
      ids: { bahia: BAHIAS[b].id, servicio: SERVICIOS[s].id, tecnico: T1 },
    };
  };
  return [
    t(sumarDias(HOY, 6), '10:00', 1, 1, 'programado', 1),
    t(sumarDias(HOY, 2), '08:30', 0, 0, 'programado', 2),
    t(sumarDias(HOY, -12), '15:00', 2, 2, 'atendido', 3),
    t(sumarDias(HOY, -30), '09:00', 0, 0, 'cancelado', 4),
  ];
}

// --- Sprint 22: vehiculos, politica, strikes y orden de trabajo ---------
const VEHICULO = {
  id: 'aeaeaeae-0000-4000-8000-000000000001',
  usuarioId: CLIENTES[0].id,
  placa: 'ABC123',
  marca: 'Renault',
  modelo: 'Logan',
  anio: 2019,
  kilometraje: 45210,
  activo: true,
};
const POLITICA = { ventanaHoras: 4, vigenciaStrikesMeses: 12, strikesParaPrepago: 3, strikesVigentes: 1, requierePrepago: false };

function strikes(conCliente: boolean) {
  const base = {
    taller: { id: TALLER.id, nombre: TALLER.nombre },
    ...(conCliente ? { cliente: { id: CLIENTES[0].id, nombre: CLIENTES[0].nombre, email: CLIENTES[0].email } } : {}),
  };
  return [
    {
      ...base,
      id: 'strike-1',
      motivo: 'cancelacion_tardia',
      detalle: `Cancelaste el turno del ${sumarDias(HOY, -3)} a las 10:00 con 2 h 15 min de anticipacion (sin strike: hasta 4 h antes).`,
      creadoEn: instante(sumarDias(HOY, -3), '07:45'),
      venceEn: instante('2027-09-21', '07:45'),
      estado: 'vigente',
      anulacion: null,
      turno: { id: 'mio-9', inicio: instante(sumarDias(HOY, -3), '10:00'), servicio: 'Cambio de aceite' },
      reclamo: {
        texto: 'Llame al taller dos dias antes para avisar y me dijeron que quedaba cancelado.',
        creadoEn: instante(sumarDias(HOY, -2), '09:00'),
        resultado: null,
        respuesta: null,
        resueltoEn: null,
      },
    },
    {
      ...base,
      id: 'strike-2',
      motivo: 'no_asistio',
      detalle: `No asististe al turno del ${sumarDias(HOY, -40)} a las 08:30.`,
      creadoEn: instante(sumarDias(HOY, -40), '09:00'),
      venceEn: instante('2027-08-15', '09:00'),
      estado: 'anulado',
      anulacion: { en: instante(sumarDias(HOY, -39), '11:00'), justificacion: 'El taller corrigio el cierre del turno: quedo como atendido.' },
      turno: { id: 'mio-8', inicio: instante(sumarDias(HOY, -40), '08:30'), servicio: 'Diagnostico electrico' },
      reclamo: null,
    },
  ];
}

/** Orden del turno de hoy de Carlos: con recepcion aceptada, o sin recepcion. */
function orden(conRecepcion: boolean) {
  const inicio = instante(HOY, '13:00');
  return {
    numero: conRecepcion ? 41 : null,
    taller: { id: TALLER.id, nombre: TALLER.nombre, razonSocial: FISCAL.razonSocial, nit: FISCAL.nit, dv: FISCAL.dv, direccion: FISCAL.direccion, municipio: FISCAL.municipio },
    cliente: { id: CLIENTES[0].id, nombre: CLIENTES[0].nombre, email: CLIENTES[0].email, telefono: CLIENTES[0].telefono },
    turno: {
      id: conRecepcion ? 'dddddddd-0000-4000-8000-000000000001' : 'dddddddd-0000-4000-8000-000000000002',
      inicio,
      fin: masMin(inicio, 60),
      estado: 'programado',
      bahia: 'Bahia 1',
      servicio: { id: S[0], nombre: 'Cambio de aceite', categoria: 'mecanica' },
      tecnico: { id: T1, nombre: 'Carlos Rojas' },
      precio: SERVICIOS[0].precio,
      anticipo: null,
      canceladoPor: null,
      motivoCancelacion: null,
    },
    vehiculo: conRecepcion ? { ...VEHICULO } : null,
    recepcion: conRecepcion
      ? {
          id: 'rec-1',
          numero: 41,
          kilometraje: 45210,
          nivelCombustible: 1,
          estadoVehiculo: 'Rayon en la puerta trasera izquierda. Testigo de aceite encendido.',
          objetosDejados: 'Silla de bebe',
          observaciones: null,
          fechaProbableEntrega: masMin(inicio, 60),
          recibidoPor: 'Carlos Rojas',
          creadoEn: instante(HOY, '12:52'),
          aceptacion: { en: instante(HOY, '12:55'), medio: 'presencial', nombre: 'Maria Gomez', documento: 'CC 52123456' },
          fotos: [],
        }
      : null,
    atencion: conRecepcion
      ? { inicio: instante(HOY, '13:02'), fin: null, notas: 'Cambio de aceite 10W-40 y filtro.' }
      : { inicio: null, fin: null, notas: null },
    garantia: { dias: 90, hasta: null, texto: 'Garantia del servicio: 90 dias desde la entrega del vehiculo (Decreto 735 de 2013).' },
  };
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
    if (ruta === '/bahias/todas')
      return responder(route, [...BAHIAS.map((b) => ({ ...b, activa: true })), { id: 'b1b1b1b1-0000-4000-8000-000000000009', nombre: 'Bahia de pintura', activa: false }]);
    if (ruta === '/configuracion/fiscal') return responder(route, FISCAL);
    if (ruta === '/configuracion/horario') return responder(route, HORARIO);
    if (ruta === '/appointments/sin-tecnico')
      return responder(route, [
        {
          id: 'sin-tecnico-1',
          inicio: instante(sumarDias(HOY, 1), '10:00'),
          fin: instante(sumarDias(HOY, 1), '10:30'),
          bahia: 'Bahia 2',
          servicio: 'Cambio de aceite',
          cliente: 'Jorge Diaz',
        },
      ]);
    if (ruta === '/servicios') return responder(route, SERVICIOS);
    if (ruta === '/technicians') return responder(route, TECNICOS.map(({ id, nombre }) => ({ id, nombre })));
    if (ruta === '/usuarios') return responder(route, q('rol') === 'cliente' ? CLIENTES : TECNICOS);
    if (ruta === '/appointments/disponibilidad') return responder(route, disponibilidad(q('fecha') ?? HOY));
    if (ruta === '/appointments/mios') return responder(route, misTurnos());
    if (ruta === '/vehiculos') return responder(route, [VEHICULO]);
    if (ruta === '/politica') return responder(route, POLITICA);
    if (ruta === '/strikes/mios') return responder(route, strikes(false));
    if (ruta === '/strikes') return responder(route, q('estado') === 'reclamos' ? strikes(true).slice(0, 1) : strikes(true));
    if (ruta === '/appointments/dddddddd-0000-4000-8000-000000000001/orden') return responder(route, orden(true));
    if (ruta === '/appointments/dddddddd-0000-4000-8000-000000000002/orden') return responder(route, orden(false));
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
