import { expect, test } from '@playwright/test';
import {
  borrarTalleresPorSlug,
  borrarUsuariosPorEmail,
  DatosSembrados,
  limpiar,
  PASSWORD_DE_PRUEBA,
  sembrar,
  sembrarSuperadmin,
} from '../fixtures/datos-de-prueba';
import { iniciarSesionEnPanel } from '../fixtures/ui';

/**
 * Sprint 20 - Varios talleres.
 *
 * El aislamiento fino (RLS, FKs, cada endpoint) se prueba en la integracion
 * de reservas-service (tenant.integration-spec.ts). Aca, el recorrido por la
 * pantalla: el superadmin da de alta un taller y opera en otro, y el admin
 * de un taller no ve lo del taller de desarrollo.
 */
test.describe('Multi-taller', () => {
  let datos: DatosSembrados;
  let superEmail: string;
  const slugNuevo = `nuevo-e2e-${Date.now()}`;

  test.beforeAll(async () => {
    datos = await sembrar();
    superEmail = await sembrarSuperadmin(datos.sufijo);
  });

  test.afterAll(async () => {
    await borrarTalleresPorSlug([slugNuevo]);
    await limpiar(datos);
    await borrarUsuariosPorEmail([superEmail]);
  });

  test('el superadmin crea un taller y opera en el de la corrida', async ({ page }) => {
    await iniciarSesionEnPanel(page, superEmail, PASSWORD_DE_PRUEBA);
    await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Talleres' }).click();

    await page.getByLabel('Nombre del taller').fill(`Taller Nuevo ${datos.sufijo}`);
    await page.getByLabel('Identificador').fill(slugNuevo);
    await page.getByLabel('Nombre del administrador').fill('Admin Nuevo E2E');
    await page.getByLabel('Correo del administrador').fill(`admin-${slugNuevo}@turnos.dev`);
    await page.getByRole('button', { name: 'Crear taller' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'creado' })).toContainText(
      `Taller Nuevo ${datos.sufijo}`,
    );

    // Operar en el taller de la corrida: el superadmin pasa a ver lo de un
    // admin, solo de ese taller.
    const fila = page.getByRole('list', { name: 'Talleres' }).getByRole('listitem').filter({ hasText: datos.tallerNombre });
    await fila.getByRole('button', { name: 'Operar aca' }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Panel' }).click();
    await expect(page.getByTestId(`bahia-${datos.bahiaId}`)).toBeVisible();
    await expect(page.getByText('Bahia 1', { exact: true })).toHaveCount(0);
  });

  test('el admin de un taller solo ve sus bahias y su nombre en el encabezado', async ({ page }) => {
    await iniciarSesionEnPanel(page, datos.adminEmail, PASSWORD_DE_PRUEBA);
    // El encabezado lo pinta una vez para escritorio y otra para celular.
    await expect(page.getByTestId('taller-actual').filter({ visible: true })).toHaveText(datos.tallerNombre);
    await page.goto('/admin');
    await expect(page.getByTestId(`bahia-${datos.bahiaId}`)).toBeVisible();
    // Las bahias de desarrollo ("Bahia 1".."Bahia 3") son de otro taller.
    await expect(page.getByText('Bahia 1', { exact: true })).toHaveCount(0);
  });
});
