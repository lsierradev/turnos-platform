#!/usr/bin/env node
// Verifica el sistema de diseno contra WCAG 2.x AA leyendo los tokens
// DIRECTAMENTE de src/index.css (no de una copia: si alguien cambia un rol
// ahi, esto lo ve). Corre en CI como el `test` de admin-web.
//
// Que se chequea, en modo claro y oscuro:
//   - Texto (1.4.3): >= 4.5:1 para cada par texto/fondo que la app usa.
//   - No-texto (1.4.11): >= 3:1 del anillo de foco, los colores solidos
//     semanticos, los estados y las series de graficos contra la tarjeta.
//   - Distinguibilidad: estados y series de a pares, dE2000 >= 20 en
//     vision normal y >= 8 simulando protanopia, deuteranopia y tritanopia.
//     No es un criterio WCAG (los estados siempre llevan etiqueta), pero es
//     lo que hace que se lean "de un vistazo".
//
// Si se agrega un rol nuevo en index.css, agregar aca los pares en que se
// usa: lo que no esta declarado no se verifica.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contraste, deltaE2000, simular, sobre } from './color.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
// Ruta opcional: permite probar un CSS alternativo sin tocar el real.
const ruta = process.argv[2] ?? join(aqui, '../src/index.css');
const css = readFileSync(ruta, 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

function variablesDeBloque(selector) {
  const inicio = css.indexOf(`${selector} {`);
  if (inicio === -1) throw new Error(`No se encontro el bloque ${selector}`);
  let nivel = 0;
  let fin = inicio;
  for (let i = css.indexOf('{', inicio); i < css.length; i++) {
    if (css[i] === '{') nivel++;
    if (css[i] === '}' && --nivel === 0) {
      fin = i;
      break;
    }
  }
  const vars = {};
  for (const [, nombre, valor] of css
    .slice(inicio, fin)
    .matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    vars[nombre] = valor.trim();
  }
  return vars;
}

const primitivos = variablesDeBloque('@theme static');
const modos = {
  claro: variablesDeBloque(':root'),
  oscuro: { ...variablesDeBloque(':root'), ...variablesDeBloque('.dark') },
};

function resolver(tokens, nombre, visitados = new Set()) {
  if (visitados.has(nombre)) throw new Error(`Referencia circular en --${nombre}`);
  visitados.add(nombre);
  const valor = tokens[nombre] ?? primitivos[nombre];
  if (valor === undefined) throw new Error(`Token --${nombre} no definido`);
  const ref = valor.match(/^var\(--([\w-]+)\)$/);
  if (ref) return resolver(tokens, ref[1], visitados);
  if (!/^#[0-9a-f]{6}$/i.test(valor)) {
    throw new Error(`--${nombre} = "${valor}": se esperaba un hex de 6 digitos`);
  }
  return valor.toLowerCase();
}

const SEMANTICOS = ['exito', 'advertencia', 'error', 'info'];
const ESTADOS = ['libre', 'reservado', 'en-servicio', 'demorado', 'inactivo'];
const SERIES = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'];

// [texto, fondo] -- todos los pares que la app pinta.
const PARES_TEXTO = [
  ['foreground', 'background'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['primary-foreground', 'primary'],
  ['secondary-foreground', 'secondary'],
  ['accent-foreground', 'accent'],
  ['sidebar-foreground', 'sidebar'],
  ['sidebar-primary-foreground', 'sidebar-primary'],
  ['sidebar-accent-foreground', 'sidebar-accent'],
  ...['background', 'card', 'muted'].flatMap((fondo) => [
    ['foreground', fondo],
    ['muted-foreground', fondo],
    ['marca-texto', fondo],
    ['destructive', fondo],
    ...SEMANTICOS.map((s) => [`${s}-texto`, fondo]),
  ]),
  ...SEMANTICOS.flatMap((s) => [
    [`${s}-texto`, `${s}-suave`],
    ['foreground', `${s}-suave`],
  ]),
  ...ESTADOS.map((e) => ['foreground', `estado-${e}-suave`]),
  // Componentes de estado (Sprint 14): EstadoError pinta titulo
  // destructive y detalle muted-foreground sobre error-suave.
  ['destructive', 'error-suave'],
  ['muted-foreground', 'error-suave'],
  // Bloques de la agenda (Sprint 15): texto normal sobre el suave de cada
  // categoria de servicio.
  ...['mecanica', 'electrica', 'latoneria'].flatMap((c) => [
    ['foreground', `categoria-${c}-suave`],
    ['muted-foreground', `categoria-${c}-suave`],
  ]),
];

const CATEGORIAS = ['mecanica', 'electrica', 'latoneria'].map((c) => `categoria-${c}`);

const NO_TEXTO = [
  'ring',
  ...SEMANTICOS,
  ...ESTADOS.map((e) => `estado-${e}`),
  ...SERIES,
];

// Badge y boton "destructive" pintan texto destructive sobre el mismo
// color al 10% (claro) / 20% (oscuro) encima de la tarjeta.
const TINTE_DESTRUCTIVE = { claro: 0.1, oscuro: 0.2 };

let fallas = 0;
let chequeos = 0;
function registrar(ok, linea) {
  chequeos++;
  if (!ok) {
    fallas++;
    console.log(`  FALLA  ${linea}`);
  }
}

for (const [modo, tokens] of Object.entries(modos)) {
  const t = (n) => resolver(tokens, n);
  console.log(`\n== Modo ${modo}`);

  for (const [texto, fondo] of PARES_TEXTO) {
    const r = contraste(t(texto), t(fondo));
    registrar(r >= 4.5, `texto  ${texto} sobre ${fondo}: ${r.toFixed(2)}:1 (min 4.5)`);
  }

  const tinte = sobre(t('destructive'), TINTE_DESTRUCTIVE[modo], t('card'));
  const rTinte = contraste(t('destructive'), tinte);
  registrar(rTinte >= 4.5, `texto  destructive sobre destructive/${TINTE_DESTRUCTIVE[modo] * 100}: ${rTinte.toFixed(2)}:1`);

  for (const n of [...NO_TEXTO, ...CATEGORIAS]) {
    const r = contraste(t(n), t('card'));
    registrar(r >= 3, `grafico ${n} sobre card: ${r.toFixed(2)}:1 (min 3)`);
  }
  // El borde de color del bloque se apoya sobre su propio suave.
  // Sprint 19: el contorno de foco (:focus-visible en index.css) es --ring
  // SOLIDO y aparece tambien sobre el fondo de pagina y la barra lateral.
  for (const fondo of ['background', 'sidebar']) {
    const r = contraste(t('ring'), t(fondo));
    registrar(r >= 3, `foco ring sobre ${fondo}: ${r.toFixed(2)}:1 (min 3)`);
  }

  for (const c of CATEGORIAS) {
    const r = contraste(t(c), t(`${c}-suave`));
    registrar(r >= 3, `grafico ${c} sobre ${c}-suave: ${r.toFixed(2)}:1 (min 3)`);
  }

  // En la linea de tiempo conviven las categorias, la marca de "ahora" y
  // el estado libre: se tienen que distinguir entre si. En Sprint 15
  // estado-libre quedaba afuera porque en oscuro colapsaba con la
  // categoria electrica (dE 3.9 con daltonismo); desde 15.1 chart-3 oscuro
  // es turquesa-200 y el par se separa por luminosidad (ver index.css).
  const AGENDA = [...CATEGORIAS, 'marca', 'estado-libre'];

  for (const grupo of [ESTADOS.map((e) => `estado-${e}`), SERIES, AGENDA]) {
    for (let i = 0; i < grupo.length; i++) {
      for (let j = i + 1; j < grupo.length; j++) {
        const [a, b] = [t(grupo[i]), t(grupo[j])];
        const normal = deltaE2000(a, b);
        const peor = Math.min(
          ...['protan', 'deutan', 'tritan'].map((k) =>
            deltaE2000(null, null, simular(a, k), simular(b, k)),
          ),
        );
        registrar(
          normal >= 20 && peor >= 8,
          `separacion ${grupo[i]} vs ${grupo[j]}: dE ${normal.toFixed(1)} (min 20), peor daltonismo ${peor.toFixed(1)} (min 8)`,
        );
      }
    }
  }
}

console.log(`\n${chequeos} chequeos, ${fallas} fallas.`);
process.exit(fallas === 0 ? 0 : 1);
