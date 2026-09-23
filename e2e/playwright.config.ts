import { defineConfig, devices } from '@playwright/test';

const URL_WEB = process.env.E2E_WEB_URL ?? 'http://localhost:5173';
const URL_RESERVAS = process.env.E2E_RESERVAS_URL ?? 'http://localhost:3001';
const URL_USUARIOS = process.env.E2E_USUARIOS_URL ?? 'http://localhost:3002';

// Desde Sprint 10 admin-web tiene login propio, asi que NO se inyecta
// ningun token: los tests de navegador se loguean por la pantalla de login
// como lo haria una persona (ver fixtures/ui.ts). Eso hace que la sesion, la
// renovacion del token y las guardas de ruta queden cubiertas por el mismo
// recorrido, en vez de saltearse con un token fabricado.

export default defineConfig({
  testDir: './tests',
  // Las specs comparten la misma Postgres y crean turnos sobre bahias y
  // tecnicos propios de cada run. Van en serie a proposito: las constraints
  // EXCLUDE de turnos son globales y un test de concurrencia corriendo en
  // paralelo con otro haria fallar a los dos por motivos que no son el bug
  // que buscan.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : [['list']],

  use: {
    baseURL: URL_WEB,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Los tres procesos que componen el sistema. reuseExistingServer deja
  // correr la suite contra servicios ya levantados a mano en local; en CI
  // siempre se arrancan limpios.
  webServer: [
    {
      command:
        'pnpm --filter @turnos-platform/reservas-service start',
      // Readiness y no liveness: el liveness responde 200 apenas arranca el
      // proceso, aunque Postgres todavia no acepte conexiones. Esperar al
      // readiness evita que el primer test falle por una base que aun no
      // estaba lista.
      url: `${URL_RESERVAS}/reservas/health/ready`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'pnpm --filter @turnos-platform/usuarios-service start',
      url: `${URL_USUARIOS}/usuarios/health/ready`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'pnpm --filter @turnos-platform/admin-web dev',
      url: URL_WEB,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        VITE_API_URL: URL_RESERVAS,
        VITE_AUTH_URL: URL_USUARIOS,
      },
    },
  ],
});

export { URL_RESERVAS, URL_USUARIOS, URL_WEB };
