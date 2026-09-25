#!/usr/bin/env node
// Borra lo que sembro seed.js (y los turnos que haya generado el test de
// carga) usando los ids guardados en .k6-seed.json.
//
// Uso: DATABASE_URL=postgres://... node load-tests/cleanup.js

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const SEED_FILE = path.join(__dirname, '.k6-seed.json');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL no esta seteada.');
    process.exit(1);
  }
  if (!fs.existsSync(SEED_FILE)) {
    console.error(`No existe ${SEED_FILE} -- nada que limpiar (¿ya corriste seed.js?).`);
    process.exit(1);
  }

  const { tallerId, bahiaId, servicioId, usuarioId, tecnicoId, adminId } = JSON.parse(
    fs.readFileSync(SEED_FILE, 'utf8'),
  );

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query(
      'DELETE FROM turnos WHERE bahia_id = $1 OR tecnico_id = $2',
      [bahiaId, tecnicoId],
    );
    await client.query('DELETE FROM servicios WHERE id = $1', [servicioId]);
    await client.query('DELETE FROM bahias WHERE id = $1', [bahiaId]);
    // adminId puede faltar si el .k6-seed.json lo dejo una corrida anterior
    // a Sprint 9; ANY() con un array filtrado lo tolera.
    await client.query('DELETE FROM usuarios WHERE id = ANY($1)', [
      [usuarioId, tecnicoId, adminId].filter(Boolean),
    ]);
    // Sprint 20. Va al final: los turnos, bahias y el personal lo referencian.
    // clientes_taller se borra en cascada.
    if (tallerId) {
      await client.query('DELETE FROM talleres WHERE id = $1', [tallerId]);
    }

    fs.unlinkSync(SEED_FILE);
    console.error('Limpieza OK.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
