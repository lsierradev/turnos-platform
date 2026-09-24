import { expect, test } from '@playwright/test';
import {
  aLasEnTaller,
  DatosSembrados,
  limpiar,
  PASSWORD_DE_PRUEBA,
  sembrar,
  sembrarTurnos,
} from '../fixtures/datos-de-prueba';
import { encabezados, iniciarSesion } from '../fixtures/sesion';
import { iniciarSesionEnPanel } from '../fixtures/ui';
import { URL_RESERVAS } from '../playwright.config';

/**
 * Sprint 16 - Panel administrativo con datos reales (GET /bahias/carga).
 *
 * Dia fijo del pasado, como hu4: el panel agrega TODAS las bahias activas,
 * asi que en un dia real se mezclarian turnos de otras corridas. Se
 * localiza la tarjeta de la bahia sembrada por su data-testid.
 */
const DIA = '2018-06-12';

test.describe('Panel del taller - carga por bahia', () => {
  let datos: DatosSembrados;

  test.beforeAll(async () => {
    datos = await sembrar();
    // 17 turnos de 30 min seguidos desde las 08:00 = 8 h 30 min = 85% de
    // la jornada: ocupacion alta. Uno cancelado en el medio NO cuenta.
    const turnos = Array.from({ length: 17 }, (_, i) => ({
      inicio: aLasEnTaller(DIA, 8 + Math.floor(i / 2), (i % 2) * 30),
      estado: 'programado' as const,
    }));
    await sembrarTurnos(datos, turnos);
    await sembrarTurnos(datos, [
      { inicio: aLasEnTaller(DIA, 17, 0), estado: 'cancelado' },
    ]);
  });

  test.afterAll(async () => {
    await limpiar(datos);
  });

  test('muestra la ocupacion real de la bahia y la alerta', async ({ page }) => {
    await iniciarSesionEnPanel(page, datos.adminEmail, PASSWORD_DE_PRUEBA);
    await page.goto(`/admin?fecha=${DIA}`);

    await expect(page.getByText(/Datos de ejemplo/)).toHaveCount(0);

    const tarjeta = page.getByTestId(`bahia-${datos.bahiaId}`);
    await expect(tarjeta).toContainText('85%');
    await expect(tarjeta).toContainText('17 turnos');
    await expect(tarjeta).toContainText('Ocupacion alta');
    await expect(
      tarjeta.getByRole('meter', { name: /Ocupacion de/ }),
    ).toHaveAttribute('aria-valuenow', '85');

    // El aviso general nombra a la bahia.
    await expect(page.getByRole('status').filter({ hasText: 'con ocupacion alta' })).toContainText(
      `Bahia E2E ${datos.sufijo} (85%)`,
    );
  });

  test('el detalle lista los turnos de la bahia, cancelados incluidos', async ({ page }) => {
    await iniciarSesionEnPanel(page, datos.adminEmail, PASSWORD_DE_PRUEBA);
    await page.goto(`/admin?fecha=${DIA}`);

    const tarjeta = page.getByTestId(`bahia-${datos.bahiaId}`);
    await tarjeta.getByRole('button', { name: 'Ver turnos' }).click();

    const turnos = tarjeta.getByRole('list', { name: 'Turnos de la bahia' }).getByRole('listitem');
    await expect(turnos).toHaveCount(18);
    await expect(turnos.first()).toContainText('08:00–08:30');
    await expect(turnos.last()).toContainText('Cancelado');
  });

  test('la semana lleva al dia elegido', async ({ page }) => {
    await iniciarSesionEnPanel(page, datos.adminEmail, PASSWORD_DE_PRUEBA);
    await page.goto(`/admin?fecha=${DIA}&vista=semana`);

    await page
      .getByRole('button', { name: new RegExp(`^Bahia E2E ${datos.sufijo}, .*85%.*Ver el dia$`) })
      .click();

    await expect(page).not.toHaveURL(/vista=semana/);
    await expect(page.getByTestId(`bahia-${datos.bahiaId}`)).toContainText('85%');
  });

  test('un cliente no puede leer la carga', async ({ request }) => {
    const token = await iniciarSesion(request, datos.clienteEmail);
    const r = await request.get(`${URL_RESERVAS}/bahias/carga`, {
      headers: encabezados(token),
    });
    expect(r.status()).toBe(403);
  });
});
