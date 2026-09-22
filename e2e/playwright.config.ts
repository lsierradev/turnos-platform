import { defineConfig, devices } from '@playwright/test';
import * as jwt from 'jsonwebtoken';

const URL_WEB = process.env.E2E_WEB_URL ?? 'http://localhost:5173';
const URL_RESERVAS = process.env.E2E_RESERVAS_URL ?? 'http://localhost:3001';
const URL_USUARIOS = process.env.E2E_USUARIOS_URL ?? 'http://localhost:3002';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me';

// admin-web todavia no tiene login: la sesion del navegador es un token
// inyectado por env (VITE_DEV_TOKEN, ver apps/admin-web/.env.example). Vite
// lo lee del entorno del proceso al arrancar, asi que hay que firmarlo aca
// -- antes de levantar el server -- y no dentro de un test.
//
// Las dos HU que se prueban por navegador (agenda del tecnico y dashboard)
// no usan el `sub` del token para nada: toman el id del tecnico de la URL y
// el rango de fechas del filtro. Por eso alcanza con un token sintetico y no
// hace falta que exista ese usuario en la DB. Las HU de reserva, en cambio,
// SI hacen login real contra usuarios-service, porque POST /appointments
// guarda el `sub` como usuario_id y tiene FK contra usuarios.
const TOKEN_NAVEGADOR = jwt.sign(
  {
    sub: '00000000-0000-4000-8000-000000000001',
    email: 'e2e-browser@turnos.dev',
    rol: 'admin',
  },
  JWT_SECRET,
  { expiresIn: '2h' },
);

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
      url: `${URL_RESERVAS}/reservas/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'pnpm --filter @turnos-platform/usuarios-service start',
      url: `${URL_USUARIOS}/usuarios/health`,
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
        VITE_DEV_TOKEN: TOKEN_NAVEGADOR,
      },
    },
  ],
});

export { URL_RESERVAS, URL_USUARIOS, URL_WEB };
