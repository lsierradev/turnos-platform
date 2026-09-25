import { defineConfig } from '@playwright/test';
import type { OpcionesVisuales } from './visual/fixtures';

/**
 * Regresion visual de admin-web (Sprint 19).
 *
 *   pnpm --filter @turnos-platform/e2e test:visual            compara
 *   pnpm --filter @turnos-platform/e2e test:visual:actualizar  regenera
 *
 * - Microsoft Edge instalado en la maquina (channel 'msedge'): no hace
 *   falta `playwright install`.
 * - No necesita backend ni base: la API esta simulada (visual/api-simulada.ts)
 *   y el reloj congelado. Solo levanta el Vite de admin-web.
 * - Las capturas de referencia son de Windows. El renderizado de fuentes
 *   cambia entre sistemas operativos, asi que NO corre en CI (Linux): es
 *   una herramienta local para revisar cambios visuales antes de subir.
 */
const URL_WEB = process.env.E2E_WEB_URL ?? 'http://localhost:5173';

const comun = {
  channel: 'msedge',
  timezoneId: 'America/Bogota',
  locale: 'es-CO',
  // Sin transiciones ni la animacion de Recharts: cada captura es el
  // estado final, no un cuadro intermedio.
  reducedMotion: 'reduce' as const,
};
const escritorio = { ...comun, viewport: { width: 1366, height: 800 }, deviceScaleFactor: 1 };
const celular = {
  ...comun,
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
};

export default defineConfig<OpcionesVisuales>({
  testDir: './visual',
  testMatch: '**/*.visual.ts',
  snapshotPathTemplate: '{testDir}/capturas/{projectName}/{arg}{ext}',
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-visual' }]],
  expect: {
    // Tolerancia en PIXELES, no en proporcion: con 0.2% de una pagina
    // completa (miles de pixeles) un texto nuevo chico pasaba sin aviso -- asi
    // se escapo el nombre del taller en el encabezado (Sprint 20). Con Edge
    // en la misma maquina las tomas salen identicas; 50 px cubren antialias.
    toHaveScreenshot: { maxDiffPixels: 50 },
  },
  use: { baseURL: URL_WEB },
  projects: [
    { name: 'escritorio-claro', use: { ...escritorio, tema: 'claro', colorScheme: 'light' } },
    { name: 'escritorio-oscuro', use: { ...escritorio, tema: 'oscuro', colorScheme: 'dark' } },
    { name: 'celular-claro', use: { ...celular, tema: 'claro', colorScheme: 'light' } },
    { name: 'celular-oscuro', use: { ...celular, tema: 'oscuro', colorScheme: 'dark' } },
  ],
  webServer: {
    command: 'pnpm --filter @turnos-platform/admin-web dev',
    url: URL_WEB,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
