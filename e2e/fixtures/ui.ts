import { Locator, Page } from '@playwright/test';

/**
 * Titulo de una Card de shadcn.
 *
 * CardTitle renderiza un <div data-slot="card-title">, no un <h2>, asi que
 * getByRole('heading') NO lo encuentra. Se localiza por el data-slot en vez
 * de por texto suelto para no chocar con otras apariciones del mismo texto
 * en la pagina.
 */
export function tituloDeTarjeta(page: Page, texto: string): Locator {
  return page.locator('[data-slot="card-title"]', { hasText: texto });
}

/**
 * Login por la pantalla, como lo haria una persona.
 *
 * No se inyecta el token en el almacenamiento: admin-web lo guarda en
 * sessionStorage, que Playwright NO persiste con storageState (solo cubre
 * cookies y localStorage). Pasar por el formulario ademas hace que cada
 * spec de navegador ejercite de paso el login real y la guarda de rutas.
 */
export async function iniciarSesionEnPanel(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();

  // La guarda redirige a /login a quien no tenga sesion, asi que salir de
  // esa ruta es la senal de que el login efectivamente entro.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}
