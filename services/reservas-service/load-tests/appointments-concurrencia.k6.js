// Test de carga de HU2 (Sprint 3) bajo concurrencia real de HTTP, no solo a
// nivel de DB: dispara 50 POST /appointments simultaneos contra la MISMA
// bahia + tecnico + horario y verifica que exactamente uno se confirme.
// Complementa (no reemplaza) a appointments.integration-spec.ts, que ya
// prueba el caso con 2 requests en paralelo directo contra TypeORM/Nest en
// memoria -- esto prueba el mismo invariante a traves de HTTP real, con
// carga suficiente para exponer problemas de pool de conexiones que 2
// requests no alcanzarian a mostrar.
//
// Requiere:
//   - reservas-service corriendo contra una Postgres real con las
//     migraciones aplicadas (docker compose up -d + packages/database
//     migrate + pnpm --filter reservas-service start)
//   - k6 instalado (https://k6.io/docs/get-started/installation/)
//   - Datos sembrados con seed.js (ver README.md de esta carpeta)
//
// Uso:
//   node load-tests/seed.js > .k6-env.sh && source .k6-env.sh
//   k6 run -e K6_BASE_URL=http://localhost:3001 load-tests/appointments-concurrencia.k6.js
//   node load-tests/cleanup.js

import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const exitosas = new Counter('reservas_exitosas');
const conflictos = new Counter('reservas_en_conflicto');
const inesperadas = new Counter('respuestas_inesperadas');

const VUS = 50;

export const options = {
  scenarios: {
    reservas_concurrentes: {
      executor: 'per-vu-iterations',
      vus: VUS,
      iterations: 1,
      maxDuration: '30s',
    },
  },
  thresholds: {
    // La aserción real de HU2: de 50 intentos sobre el mismo horario, uno
    // solo. Si esto falla, el test entero falla (exit code != 0).
    reservas_exitosas: ['count==1'],
    conflictos: ['count>=0'], // solo para que el metric quede en el summary
    respuestas_inesperadas: ['count==0'],
  },
};

const BASE_URL = __ENV.K6_BASE_URL || 'http://localhost:3001';
const TOKEN = __ENV.K6_TOKEN;
const BAHIA_ID = __ENV.K6_BAHIA_ID;
const SERVICIO_ID = __ENV.K6_SERVICIO_ID;
const TECNICO_ID = __ENV.K6_TECNICO_ID;
// Mismo horario para todos los VUs -- ese es justamente el punto.
const INICIO =
  __ENV.K6_INICIO ||
  new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

export default function () {
  if (!TOKEN || !BAHIA_ID || !SERVICIO_ID || !TECNICO_ID) {
    throw new Error(
      'Faltan K6_TOKEN/K6_BAHIA_ID/K6_SERVICIO_ID/K6_TECNICO_ID -- correr load-tests/seed.js primero (ver README.md).',
    );
  }

  const res = http.post(
    `${BASE_URL}/appointments`,
    JSON.stringify({
      bahiaId: BAHIA_ID,
      servicioId: SERVICIO_ID,
      tecnicoId: TECNICO_ID,
      inicio: INICIO,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TOKEN}`,
      },
    },
  );

  const esExitosa = res.status === 201;
  const esConflicto = res.status === 409;

  check(res, {
    'responde 201 (confirmado) o 409 (conflicto), nunca otra cosa': () =>
      esExitosa || esConflicto,
  });

  if (esExitosa) {
    exitosas.add(1);
  } else if (esConflicto) {
    conflictos.add(1);
  } else {
    inesperadas.add(1);
    // eslint-disable-next-line no-console
    console.error(`Respuesta inesperada: ${res.status} ${res.body}`);
  }
}
