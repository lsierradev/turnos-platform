#!/usr/bin/env node
// Siembra una bahia + servicio + tecnico + usuario para el test de carga de
// k6 (mismo patron de INSERTs crudos que test/appointments.integration-spec.ts),
// firma un access token valido con el mismo JWT_SECRET que usa el guard, y
// imprime exports listos para pegar en la shell antes de correr k6.
//
// Uso:
//   DATABASE_URL=postgres://... node load-tests/seed.js > .k6-env.sh
//   source .k6-env.sh
//   k6 run -e K6_BASE_URL=http://localhost:3001 load-tests/appointments-concurrencia.k6.js

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const jwt = require('jsonwebtoken');

const SEED_FILE = path.join(__dirname, '.k6-seed.json');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL no esta seteada.');
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const bahia = await client.query(
      "INSERT INTO bahias (nombre) VALUES ('Bahia k6 load test') RETURNING id",
    );
    const servicio = await client.query(
      `INSERT INTO servicios (nombre, categoria, duracion_minutos, precio)
       VALUES ('Servicio k6 load test', 'mecanica', 30, 10000)
       RETURNING id`,
    );
    const usuario = await client.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol)
       VALUES ('k6-cliente@turnos.dev', 'hash', 'k6 Cliente', 'cliente')
       RETURNING id`,
    );
    const tecnico = await client.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol)
       VALUES ('k6-tecnico@turnos.dev', 'hash', 'k6 Tecnico', 'tecnico')
       RETURNING id`,
    );

    const ids = {
      bahiaId: bahia.rows[0].id,
      servicioId: servicio.rows[0].id,
      usuarioId: usuario.rows[0].id,
      tecnicoId: tecnico.rows[0].id,
    };

    const token = jwt.sign(
      { sub: ids.usuarioId, email: 'k6-cliente@turnos.dev', rol: 'cliente' },
      process.env.JWT_SECRET ?? 'dev-secret-change-me',
      { expiresIn: '1h' },
    );

    fs.writeFileSync(SEED_FILE, JSON.stringify(ids, null, 2));

    // stdout: solo los exports, para poder hacer `node seed.js > .k6-env.sh && source .k6-env.sh`
    console.log(`export K6_BAHIA_ID=${ids.bahiaId}`);
    console.log(`export K6_SERVICIO_ID=${ids.servicioId}`);
    console.log(`export K6_TECNICO_ID=${ids.tecnicoId}`);
    console.log(`export K6_TOKEN=${token}`);

    console.error(`Sembrado OK. IDs guardados en ${SEED_FILE} para cleanup.js.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
