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
    // Sprint 20: todo lo sembrado vive en un taller propio, asi la medicion
    // no se mezcla con los datos del taller de desarrollo.
    const taller = await client.query(
      "INSERT INTO talleres (nombre, slug) VALUES ('Taller k6 load test', 'k6-load-test') RETURNING id",
    );
    const tallerId = taller.rows[0].id;

    const bahia = await client.query(
      "INSERT INTO bahias (nombre, taller_id) VALUES ('Bahia k6 load test', $1) RETURNING id",
      [tallerId],
    );
    const servicio = await client.query(
      `INSERT INTO servicios (nombre, categoria, duracion_minutos, precio_base_centavos, taller_id)
       VALUES ('Servicio k6 load test', 'mecanica', 30, 10000, $1)
       RETURNING id`,
      [tallerId],
    );
    const usuario = await client.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol)
       VALUES ('k6-cliente@turnos.dev', 'hash', 'k6 Cliente', 'cliente')
       RETURNING id`,
    );
    await client.query(
      'INSERT INTO clientes_taller (taller_id, usuario_id) VALUES ($1, $2)',
      [tallerId, usuario.rows[0].id],
    );
    const tecnico = await client.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol, taller_id)
       VALUES ('k6-tecnico@turnos.dev', 'hash', 'k6 Tecnico', 'tecnico', $1)
       RETURNING id`,
      [tallerId],
    );
    // Desde Sprint 9 la agenda y el dashboard exigen rol admin: el token de
    // cliente sirve para reservar, no para las lecturas que mide
    // latencia-lectura.k6.js.
    const admin = await client.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol, taller_id)
       VALUES ('k6-admin@turnos.dev', 'hash', 'k6 Admin', 'admin', $1)
       RETURNING id`,
      [tallerId],
    );

    const ids = {
      tallerId,
      bahiaId: bahia.rows[0].id,
      servicioId: servicio.rows[0].id,
      usuarioId: usuario.rows[0].id,
      tecnicoId: tecnico.rows[0].id,
      adminId: admin.rows[0].id,
    };

    const token = jwt.sign(
      { sub: ids.usuarioId, email: 'k6-cliente@turnos.dev', rol: 'cliente', taller: null },
      process.env.JWT_SECRET ?? 'dev-secret-change-me',
      { expiresIn: '1h' },
    );

    const tokenAdmin = jwt.sign(
      { sub: ids.adminId, email: 'k6-admin@turnos.dev', rol: 'admin', taller: tallerId },
      process.env.JWT_SECRET ?? 'dev-secret-change-me',
      { expiresIn: '1h' },
    );

    fs.writeFileSync(SEED_FILE, JSON.stringify(ids, null, 2));

    // stdout: solo los exports, para poder hacer `node seed.js > .k6-env.sh && source .k6-env.sh`
    console.log(`export K6_TALLER_ID=${ids.tallerId}`);
    console.log(`export K6_BAHIA_ID=${ids.bahiaId}`);
    console.log(`export K6_SERVICIO_ID=${ids.servicioId}`);
    console.log(`export K6_TECNICO_ID=${ids.tecnicoId}`);
    console.log(`export K6_TOKEN=${token}`);
    console.log(`export K6_ADMIN_TOKEN=${tokenAdmin}`);

    console.error(`Sembrado OK. IDs guardados en ${SEED_FILE} para cleanup.js.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
