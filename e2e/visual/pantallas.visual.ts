import { HOY, IDS } from './api-simulada';
import { capturar, expect, test } from './fixtures';

/**
 * Una captura por pantalla y estado relevante, en los 4 proyectos del
 * config (escritorio/celular x claro/oscuro). Antes de cada captura se
 * espera algo que solo aparece con los datos cargados: sin eso se
 * compararian skeletons.
 */

test.describe('publicas', () => {
  test.beforeEach(async ({ entrarComo }) => entrarComo(null));

  test('login', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'turnos-platform' })).toBeVisible();
    await capturar(page, 'login');
  });

  test('olvide mi contrasena', async ({ page }) => {
    await page.goto('/olvide');
    await expect(page.getByRole('heading', { name: 'Olvide mi contraseña' })).toBeVisible();
    await capturar(page, 'olvide');
  });

  test('definir contrasena', async ({ page }) => {
    await page.goto(`/restablecer?token=${'x'.repeat(43)}`);
    await expect(page.getByRole('heading', { name: 'Defini tu contraseña' })).toBeVisible();
    await capturar(page, 'restablecer');
  });
});

test.describe('admin', () => {
  test.beforeEach(async ({ entrarComo }) => entrarComo('admin'));

  test('inicio', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: /Dashboard/ }).last()).toBeVisible();
    await capturar(page, 'admin-inicio');
  });

  test('reservar con horario elegido', async ({ page }) => {
    await page.goto(`/reservar?fecha=2026-09-25&bahia=${IDS.bahia}&servicio=${IDS.servicio}&tecnico=${IDS.tecnico}`);
    await page.getByRole('button', { name: '08:30', exact: true }).click();
    await expect(page.getByText('08:30–09:00')).toBeVisible();
    await capturar(page, 'admin-reservar');
  });

  test('reservar cliente nuevo', async ({ page }) => {
    await page.goto('/reservar');
    await page.getByRole('button', { name: 'Cliente nuevo' }).click();
    await expect(page.getByLabel('Ciudad')).toBeVisible();
    await capturar(page, 'admin-reservar-cliente-nuevo');
  });

  test('elegir tecnico', async ({ page }) => {
    await page.goto('/agenda');
    await expect(page.getByRole('option', { name: /Diana Perez/ })).toBeVisible();
    await capturar(page, 'admin-agenda-elegir');
  });

  test('agenda del dia', async ({ page }) => {
    await page.goto(`/agenda/${IDS.tecnico}?fecha=${HOY}`);
    await expect(page.getByText('Latoneria menor').first()).toBeVisible();
    await capturar(page, 'admin-agenda-dia');
  });

  test('agenda de la semana', async ({ page }) => {
    await page.goto(`/agenda/${IDS.tecnico}?fecha=${HOY}&vista=semana`);
    // En el celular la semana muestra otra disposicion y el nombre queda
    // oculto: alcanza con que los datos esten cargados.
    await expect(page.getByText('Latoneria menor').first()).toBeAttached();
    await capturar(page, 'admin-agenda-semana');
  });

  test('panel del dia', async ({ page }) => {
    await page.goto(`/admin?fecha=${HOY}`);
    await expect(page.getByTestId('panel-ocupacion-valor')).toBeVisible();
    await capturar(page, 'admin-panel-dia');
  });

  test('panel de la semana', async ({ page }) => {
    await page.goto(`/admin?fecha=${HOY}&vista=semana`);
    await expect(page.getByRole('button', { name: /Ver el dia$/ }).first()).toBeVisible();
    await capturar(page, 'admin-panel-semana');
  });

  test('dashboard con graficos', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('svg.recharts-surface').first()).toBeVisible();
    await expect(page.getByTestId('kpi-turnos-totales-comparacion')).toBeVisible();
    await capturar(page, 'admin-dashboard');
  });

  test('dashboard en tabla', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Ver tabla' }).click();
    await expect(page.getByRole('table')).toBeVisible();
    await capturar(page, 'admin-dashboard-tabla');
  });

  test('sistema de diseno', async ({ page }) => {
    await page.goto('/design');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await capturar(page, 'admin-design');
  });

  test('pagina no encontrada', async ({ page }) => {
    await page.goto('/no-existe');
    await expect(page.getByText('Esta pagina no existe')).toBeVisible();
    await capturar(page, 'admin-404');
  });
});

test.describe('tecnico', () => {
  test.beforeEach(async ({ entrarComo }) => entrarComo('tecnico'));

  test('inicio', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Ver mi agenda de hoy' })).toBeVisible();
    await capturar(page, 'tecnico-inicio');
  });

  test('mis indicadores', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Mis indicadores' })).toBeVisible();
    await expect(page.locator('svg.recharts-surface').first()).toBeVisible();
    await capturar(page, 'tecnico-indicadores');
  });
});

test.describe('cliente', () => {
  test.beforeEach(async ({ entrarComo }) => entrarComo('cliente'));

  test('inicio', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Tu proximo turno' })).toContainText('Cambio de aceite');
    await capturar(page, 'cliente-inicio');
  });

  test('mis turnos', async ({ page }) => {
    await page.goto('/mis-turnos');
    await expect(page.getByRole('list', { name: 'Historial de turnos' })).toBeVisible();
    await capturar(page, 'cliente-mis-turnos');
  });
});
