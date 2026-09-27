#!/usr/bin/env node
// SHA-256 de cada texto legal (src/modules/legal/textos), tal como lo
// calcula el servicio (fin de linea normalizado a \n). Sirve para anotar
// el hash de una version NUEVA en catalogo.ts:
//
//   node services/usuarios-service/scripts/hash-textos-legales.js
//
// Nunca para "arreglar" el hash de una version que ya se acepto: esa
// version no se edita, se publica otra (ver docs/legal/README.md).

const { createHash } = require('crypto');
const { readdirSync, readFileSync } = require('fs');
const { join } = require('path');

const dir = join(__dirname, '..', 'src', 'modules', 'legal', 'textos');
for (const archivo of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
  const texto = readFileSync(join(dir, archivo), 'utf8').replace(/\r\n/g, '\n');
  const hash = createHash('sha256').update(texto, 'utf8').digest('hex');
  console.log(`${hash}  ${archivo}`);
}
