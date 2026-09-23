#!/usr/bin/env node
// Siembra un ano de turnos historicos sobre la bahia/tecnico que dejo
// seed.js, para que latencia-lectura.k6.js mida algo real.
//
// Por que hace falta: contra una base recien migrada, cualquier consulta
// pasa el p95 < 300 ms y el test no detecta nada. Las consultas que
// costaban caro en este repo lo hacian por recorrer el HISTORICO completo
// (ver el arreglo de TechniciansService y buscarSugerencias en Sprint 9), y
// con 20 filas no hay historico que recorrer. Medir rendimiento con la base
// vacia da una falsa sensacion de cumplimiento.
//
// Uso:
//   DATABASE_URL=postgres://... node load-tests/seed.js > .k6-env.sh
//   source .k6-env.sh
//   DATABASE_URL=postgres://... node load-tests/seed-volumen.js
//   k6 run -e K6_BASE_URL=http://localhost:3001 load-tests/latencia-lectura.k6.js
//   DATABASE_URL=postgres://... node load-tests/cleanup.js   # borra tambien esto

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const SEED_FILE = path.join(__dirname, '.k6-seed.json');

const DIAS_HISTORIA = Number(process.env.K6_DIAS_HISTORIA ?? 365);
const TURNOS_POR_DIA = Number(process.env.K6_TURNOS_POR_DIA ?? 16);
const DURACION_MINUTOS = 30;
const HORA_APERTURA = 8;

// Se insertan en lotes en vez de fila por fila: 365 x 16 son ~5800 INSERTs,
// y uno por round-trip tarda minutos contra una Postgres remota.
const TAMANIO_LOTE = 500;

function estadoPara(indice) {
  // Mezcla realista: la mayoria atendidos, algunos no_asistio y cancelados.
  // El dashboard necesita las tres para que los KPIs no sean degenerados.
  if (indice % 11 === 0) return 'cancelado';
  if (indice % 7 === 0) return 'no_asistio';
  return 'atendido';
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL no esta seteada.');
    process.exit(1);
  }
  if (!fs.existsSync(SEED_FILE)) {
    console.error(`No existe ${SEED_FILE} -- correr load-tests/seed.js primero.`);
    process.exit(1);
  }

  const { bahiaId, servicioId, usuarioId, tecnicoId } = JSON.parse(
    fs.readFileSync(SEED_FILE, 'utf8'),
  );

  const client = new Client({ connectionString });
  await client.connect();

  try {
    let lote = [];
    let insertados = 0;
    let indice = 0;

    // Hasta dia = 0 inclusive, o sea incluyendo HOY: latencia-lectura.k6.js
    // consulta la agenda del dia de hoy, y si hoy quedara vacio esa medicion
    // no estaria midiendo nada.
    for (let dia = DIAS_HISTORIA; dia >= 0; dia -= 1) {
      for (let n = 0; n < TURNOS_POR_DIA; n += 1) {
        const inicio = new Date();
        inicio.setUTCDate(inicio.getUTCDate() - dia);
        inicio.setUTCHours(HORA_APERTURA, 0, 0, 0);
        inicio.setUTCMinutes(n * DURACION_MINUTOS);

        const fin = new Date(inicio.getTime() + DURACION_MINUTOS * 60_000);
        const estado = estadoPara(indice);
        // Solo los atendidos llevan horas reales, igual que en produccion:
        // el KPI de tiempo promedio se calcula sobre los cronometrados.
        const medido = estado === 'atendido';

        lote.push([
          bahiaId,
          servicioId,
          // usuario_id queda NULL en el historico: con la constraint
          // turnos_usuario_rango_excl (010), un unico usuario no puede tener
          // 5800 turnos que se solapan entre dias... y sobre todo, atarlos
          // todos al mismo cliente no se parece a la realidad.
          n === 0 ? usuarioId : null,
          tecnicoId,
          inicio.toISOString(),
          fin.toISOString(),
          estado,
          medido ? inicio.toISOString() : null,
          medido
            ? new Date(inicio.getTime() + (20 + (indice % 30)) * 60_000).toISOString()
            : null,
        ]);
        indice += 1;

        if (lote.length >= TAMANIO_LOTE) {
          insertados += await insertarLote(client, lote);
          lote = [];
          process.stderr.write(`\rInsertados ${insertados} turnos...`);
        }
      }
    }

    if (lote.length) {
      insertados += await insertarLote(client, lote);
    }

    // Sin estadisticas frescas, el planner sigue creyendo que la tabla es
    // chica y elige planes que no son los que va a usar en produccion: la
    // medicion saldria mejor de lo que corresponde.
    await client.query('ANALYZE turnos');

    process.stderr.write('\n');
    console.error(
      `Sembrados ${insertados} turnos historicos. cleanup.js los borra junto con el resto.`,
    );
  } finally {
    await client.end();
  }
}

async function insertarLote(client, lote) {
  const valores = [];
  const parametros = [];

  lote.forEach((fila, i) => {
    const base = i * 9;
    valores.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4},
        tstzrange($${base + 5}::timestamptz, $${base + 6}::timestamptz, '[)'),
        $${base + 7}::estado_turno, $${base + 8}::timestamptz, $${base + 9}::timestamptz)`,
    );
    parametros.push(...fila);
  });

  const resultado = await client.query(
    `INSERT INTO turnos
       (bahia_id, servicio_id, usuario_id, tecnico_id, rango_tiempo,
        estado, atencion_inicio, atencion_fin)
     VALUES ${valores.join(',')}
     ON CONFLICT DO NOTHING`,
    parametros,
  );

  return resultado.rowCount ?? 0;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
