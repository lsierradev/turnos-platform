import { expect, test } from '@playwright/test';
import { readFileSync } from 'fs';
import {
  aLasEnTaller,
  DatosSembrados,
  horarioLaboral,
  limpiar,
  PASSWORD_DE_PRUEBA,
  sembrar,
  sembrarTokenContrasena,
  sembrarTurnos,
} from '../fixtures/datos-de-prueba';
import { iniciarSesionEnPanel } from '../fixtures/ui';

/**
 * Sprint 18 - Dashboard pulido, vista por rol y contrasena por correo.
 *
 * Dias fijos del pasado (como hu4): el dashboard del taller entero suma
 * todos los turnos del dia, asi que un dia real mezclaria otras corridas.
 * El dia anterior tambien se siembra: es contra lo que compara.
 */
const DIA = '2018-08-15';
const DIA_ANTERIOR = '2018-08-14';

test.describe('Sprint 18', () => {
  let datos: DatosSembrados;

  test.beforeAll(async () => {
    datos = await sembrar();
    await sembrarTurnos(datos, [
      // DIA: 3 atendidos + 1 no asistio -> 75%; 40 min promedio.
      { inicio: aLasEnTaller(DIA, 8), estado: 'atendido', minutosAtencion: 30 },
      { inicio: aLasEnTaller(DIA, 10), estado: 'atendido', minutosAtencion: 50 },
      { inicio: aLasEnTaller(DIA, 12), estado: 'atendido', minutosAtencion: 40 },
      { inicio: aLasEnTaller(DIA, 14), estado: 'no_asistio' },
      // DIA_ANTERIOR: 1 y 1 -> 50%, 2 turnos.
      { inicio: aLasEnTaller(DIA_ANTERIOR, 9), estado: 'atendido', minutosAtencion: 60 },
      { inicio: aLasEnTaller(DIA_ANTERIOR, 11), estado: 'no_asistio' },
      // Uno por delante, para "Mis turnos" del cliente.
      { inicio: horarioLaboral(10, 3), estado: 'programado' },
    ]);
  });

  test.afterAll(async () => {
    await limpiar(datos);
  });

  async function dashboardDelDia(page: import('@playwright/test').Page) {
    await page.goto('/dashboard');
    await page.getByLabel('Hasta').fill(DIA);
    await page.getByLabel('Desde').fill(DIA);
  }

  test('admin: KPIs comparados con el dia anterior, filtro por tecnico, tabla y CSV', async ({ page }) => {
    await iniciarSesionEnPanel(page, datos.adminEmail, PASSWORD_DE_PRUEBA);
    await dashboardDelDia(page);
    await page.getByLabel('Tecnico').selectOption({ label: `Tecnico E2E ${datos.sufijo}` });

    await expect(page.getByTestId('kpi-tasa-asistencia-valor')).toHaveText('75%', { timeout: 15_000 });
    await expect(page.getByTestId('kpi-tasa-asistencia-comparacion')).toHaveText(
      '+25 pts vs. el dia anterior (50%)',
    );
    await expect(page.getByTestId('kpi-turnos-totales-comparacion')).toHaveText(
      '+2 (+100%) vs. el dia anterior (2)',
    );
    await expect(page.getByTestId('kpi-tiempo-promedio-comparacion')).toHaveText(
      '-20 min vs. el dia anterior (60 min)',
    );

    // Tabla accesible: caption, dia como encabezado de fila y total.
    await page.getByRole('button', { name: 'Ver tabla' }).click();
    const tabla = page.getByRole('table', { name: /Detalle diario/ });
    await expect(tabla).toContainText(`Tecnico E2E ${datos.sufijo}`);
    await expect(tabla.getByRole('rowheader', { name: new RegExp(DIA) })).toBeVisible();
    await expect(tabla.getByRole('row', { name: /Total del periodo/ })).toContainText('75%');

    // CSV: separador ; (Excel en espanol), BOM y la fila del dia.
    const [descarga] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Exportar CSV' }).click(),
    ]);
    const csv = readFileSync((await descarga.path())!, 'utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain(`${DIA};3;1;0;0;75;40;3`);
    expect(descarga.suggestedFilename()).toMatch(new RegExp(`^kpis_${DIA}_${DIA}-`));

    // Otro tecnico, sin turnos ese dia: estado vacio con mensaje, sin ejes.
    await page.getByRole('button', { name: 'Ver graficos' }).click();
    await page.getByLabel('Tecnico').selectOption({ label: `Otro tecnico E2E ${datos.sufijo}` });
    await expect(page.getByText('Sin turnos en este periodo')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('svg.recharts-surface')).toHaveCount(0);
  });

  test('tecnico: ve "Mis indicadores" solo con sus turnos', async ({ page }) => {
    await iniciarSesionEnPanel(page, datos.tecnicoEmail, PASSWORD_DE_PRUEBA);
    await page.getByRole('main').getByRole('link', { name: /Mis indicadores/ }).click();
    await expect(page.getByRole('heading', { name: 'Mis indicadores' })).toBeVisible();
    await expect(page.getByLabel('Tecnico')).toHaveCount(0);

    await page.getByLabel('Hasta').fill(DIA);
    await page.getByLabel('Desde').fill(DIA);
    await expect(page.getByTestId('kpi-turnos-totales-valor')).toHaveText('4', { timeout: 15_000 });
  });

  test('cliente: ve su proximo turno en el inicio y la lista en "Mis turnos"', async ({ page }) => {
    await iniciarSesionEnPanel(page, datos.clienteEmail, PASSWORD_DE_PRUEBA);
    const proximo = page.getByRole('region', { name: 'Tu proximo turno' });
    await expect(proximo).toContainText(`Bahia E2E ${datos.sufijo}`);
    await expect(proximo).toContainText('10:00');

    await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Mis turnos' }).click();
    const lista = page.getByRole('list', { name: 'Turnos proximos' });
    await expect(lista.getByRole('listitem')).toHaveCount(1);
    await expect(lista).toContainText('Programado');
    // Los de 2018 quedan fuera de los ultimos 90 dias.
    await expect(page.getByText('Todavia no hay turnos pasados.')).toBeVisible();
  });

  test('contrasena: el enlace del correo la define y se puede entrar con ella', async ({ page }) => {
    const token = await sembrarTokenContrasena(datos.clientes[4].id);
    await page.goto(`/restablecer?token=${token}`);
    await page.getByLabel('Contraseña nueva').fill('nueva-clave-e2e');
    await page.getByLabel('Repetir contraseña').fill('nueva-clave-e2e');
    await page.getByRole('button', { name: 'Guardar contraseña' }).click();
    await expect(page.getByText('Ya podes ingresar con tu correo y la contraseña nueva.')).toBeVisible();

    await iniciarSesionEnPanel(page, datos.clientes[4].email, 'nueva-clave-e2e');
    await expect(page.getByRole('button', { name: 'Reservar un turno' })).toBeVisible();

    // El mismo enlace no sirve dos veces.
    await page.getByRole('button', { name: 'Salir' }).click();
    await page.goto(`/restablecer?token=${token}`);
    await page.getByLabel('Contraseña nueva').fill('otra-clave-e2e');
    await page.getByLabel('Repetir contraseña').fill('otra-clave-e2e');
    await page.getByRole('button', { name: 'Guardar contraseña' }).click();
    await expect(page.getByText(/no es valido o ya vencio/)).toBeVisible();
  });

  test('olvide: la respuesta no revela si el correo existe', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: '¿Olvidaste tu contraseña?' }).click();
    await page.getByLabel('Correo').fill(`nadie-${datos.sufijo}@turnos.dev`);
    await page.getByRole('button', { name: 'Enviar enlace' }).click();
    await expect(page.getByText(/esta registrado, te enviamos un enlace/)).toBeVisible();
  });
});
