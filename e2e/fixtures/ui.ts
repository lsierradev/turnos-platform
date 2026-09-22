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
