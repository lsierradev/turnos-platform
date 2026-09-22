#!/usr/bin/env node
// Aplica los archivos de migrations/*.sql en orden alfabetico contra
// DATABASE_URL, usando el driver `pg` directo (sin depender de tener `psql`
// instalado, que en Windows no viene por defecto). Idempotente: lleva un
// registro de los archivos ya aplicados en la tabla schema_migrations.

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL no esta seteada.');
    process.exit(1);
  }

  const archivos = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const { rows } = await client.query('SELECT filename FROM schema_migrations');
    const aplicadas = new Set(rows.map((r) => r.filename));

    for (const archivo of archivos) {
      if (aplicadas.has(archivo)) {
        console.log(`= ${archivo} (ya aplicada, se omite)`);
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, archivo), 'utf8');
      console.log(`> aplicando ${archivo}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [archivo],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    console.log('Migraciones al dia.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
