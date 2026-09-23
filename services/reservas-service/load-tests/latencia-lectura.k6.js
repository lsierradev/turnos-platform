// Test de LATENCIA de los endpoints de lectura (Sprint 9).
//
// Complementa a appointments-concurrencia.k6.js, que es un test de
// CORRECCION: 50 VUs con una iteracion cada uno y thresholds sobre
// contadores de negocio. Ese no produce un p95 con sentido estadistico
// (una muestra por VU, sin carga sostenida) y de hecho no declara ningun
// threshold de latencia.
//
// Este mide el criterio de aceptacion "tiempo de respuesta < 300 ms p95"
// (SRS 14) sobre los dos endpoints que mas trabajo le dan a la base:
//   - GET /technicians/:id/agenda
//   - GET /dashboard/kpis
//
// IMPORTANTE - sobre el volumen de datos:
// Corrido contra una base recien migrada, esto pasa siempre y no prueba
// nada. Las consultas que costaban caro lo hacian por recorrer el
// HISTORICO (ver el arreglo de TechniciansService en Sprint 9), y con 20
// filas no hay historico que recorrer. Para que la medicion signifique
// algo hay que sembrar al menos un ano de turnos antes:
//
//   node load-tests/seed.js > .k6-env.sh && source .k6-env.sh
//   node load-tests/seed-volumen.js          # siembra historico
//   k6 run -e K6_BASE_URL=http://localhost:3001 load-tests/latencia-lectura.k6.js
//
// Los thresholds estan POR ENDPOINT y no agregados: la agenda y los KPIs
// tienen perfiles de costo muy distintos, y un p95 global esconde que uno
// de los dos se degrado.

import http from 'k6/http';
import { check, group } from 'k6';
import { Trend } from 'k6/metrics';

const latenciaAgenda = new Trend('latencia_agenda', true);
const latenciaKpis = new Trend('latencia_kpis', true);

const P95_OBJETIVO_MS = 300;

export const options = {
  scenarios: {
    lectura_sostenida: {
      // Carga constante y no un pico: un p95 se calcula sobre una
      // distribucion, y para eso hacen falta muchas muestras a lo largo del
      // tiempo, no 50 requests simultaneos.
      executor: 'constant-arrival-rate',
      rate: 20,
      timeUnit: '1s',
      duration: '1m',
      preAllocatedVUs: 20,
      maxVUs: 60,
    },
  },
  thresholds: {
    [`latencia_agenda`]: [`p(95)<${P95_OBJETIVO_MS}`],
    [`latencia_kpis`]: [`p(95)<${P95_OBJETIVO_MS}`],
    // Que no se cuele un 5xx disfrazado de respuesta rapida.
    http_req_failed: ['rate==0'],
  },
};

const BASE_URL = __ENV.K6_BASE_URL || 'http://localhost:3001';
// Token de ADMIN: desde Sprint 9 tanto la agenda como el dashboard exigen
// ese rol (o, para la agenda, ser el tecnico duenio). Lo emite seed.js.
const TOKEN = __ENV.K6_ADMIN_TOKEN;
const TECNICO_ID = __ENV.K6_TECNICO_ID;

function encabezados() {
  return { headers: { Authorization: `Bearer ${TOKEN}` } };
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function haceDiasISO(dias) {
  const fecha = new Date();
  fecha.setUTCDate(fecha.getUTCDate() - dias);
  return fecha.toISOString().slice(0, 10);
}

export default function () {
  if (!TOKEN || !TECNICO_ID) {
    throw new Error(
      'Faltan K6_ADMIN_TOKEN/K6_TECNICO_ID -- correr load-tests/seed.js primero (ver README.md).',
    );
  }

  group('agenda del tecnico', () => {
    const res = http.get(
      `${BASE_URL}/technicians/${TECNICO_ID}/agenda?date=${hoyISO()}`,
      encabezados(),
    );
    latenciaAgenda.add(res.timings.duration);
    check(res, { 'agenda responde 200': (r) => r.status === 200 });
  });

  group('kpis del dashboard', () => {
    // Rango de 30 dias: el caso realista del panel, no el de un solo dia.
    const res = http.get(
      `${BASE_URL}/dashboard/kpis?from=${haceDiasISO(29)}&to=${hoyISO()}`,
      encabezados(),
    );
    latenciaKpis.add(res.timings.duration);
    check(res, { 'kpis responde 200': (r) => r.status === 200 });
  });
}
