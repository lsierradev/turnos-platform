import { expect, test as base, type Page } from '@playwright/test';
import { AHORA, simularApi, tokenDe, type Rol } from './api-simulada';

export interface OpcionesVisuales {
  tema: 'claro' | 'oscuro';
}

/**
 * - `tema`: lo fija cada proyecto del config (claro / oscuro).
 * - `entrarComo(rol)`: API simulada + sesion inyectada, sin pasar por el
 *   login (el login tiene su propia captura).
 */
export const test = base.extend<OpcionesVisuales & { entrarComo: (rol: Rol | null) => Promise<void> }>({
  tema: ['claro', { option: true }],

  page: async ({ page, tema }, usar) => {
    // Reloj congelado: "hoy", los rangos del dashboard y los horarios
    // libres dependen de la fecha. Los timers siguen corriendo (congelarlos
    // con clock.install traba las notificaciones internas de TanStack Query).
    await page.clock.setFixedTime(AHORA);
    await page.addInitScript((t) => localStorage.setItem('turnos-tema', t), tema);
    // La pestana se reporta oculta: el polling del dashboard y del panel
    // (refetchIntervalInBackground: false) se pausa solo, y ningun refresco
    // cae en medio de una captura dejando la pagina atenuada. La carga
    // inicial no depende de esto.
    await page.addInitScript(() => {
      Object.defineProperty(document, 'visibilityState', { get: () => 'hidden' });
      Object.defineProperty(document, 'hidden', { get: () => true });
    });
    await usar(page);
  },

  entrarComo: async ({ page }, usar) => {
    await usar(async (rol) => {
      await simularApi(page, rol);
      if (rol) {
        const sesion = JSON.stringify({ accessToken: tokenDe(rol), refreshToken: 'r' });
        await page.addInitScript((s) => sessionStorage.setItem('turnos.sesion', s), sesion);
      }
    });
  },
});

/**
 * Captura de pantalla completa, estable: espera las fuentes y deja que
 * toHaveScreenshot compare hasta que dos tomas coincidan. Los elementos
 * fijos (barra lateral, pestanas del celular) salen donde estaban en la
 * ventana: es como captura Playwright una pagina completa, no un defecto.
 */
export async function capturar(page: Page, nombre: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot(`${nombre}.png`, {
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
  });
}

export { expect };
