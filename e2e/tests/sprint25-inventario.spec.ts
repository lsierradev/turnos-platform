import { expect, test } from '@playwright/test';
import { URL_RESERVAS } from '../playwright.config';
import {
  DatosSembrados,
  horarioLaboral,
  limpiar,
  PASSWORD_DE_PRUEBA,
  sembrar,
} from '../fixtures/datos-de-prueba';
import { encabezados, iniciarSesion } from '../fixtures/sesion';
import { iniciarSesionEnPanel } from '../fixtures/ui';

/**
 * Sprint 25 - Inventario de repuestos, contra los servicios reales: el
 * catalogo, una compra (entrada) que sube el stock y lo deja en el minimo
 * (dispara la alerta), y el tecnico que usa ese repuesto en su propio
 * turno. El stock nunca negativo con ventas simultaneas lo cubre la prueba
 * de integracion de reservas-service (mas facil de disparar dos requests a
 * la vez por API que por navegador).
 */
test.describe.configure({ mode: 'serial' });

test.describe('Inventario de repuestos', () => {
  let datos: DatosSembrados;
  let turnoId: string;
  const nombreRepuesto = `Filtro E2E ${Date.now()}`;

  test.beforeAll(async ({ request }) => {
    datos = await sembrar();
    // El titular del turno es el cliente; el tecnico asignado es quien
    // despues va a registrar el repuesto usado.
    const token = await iniciarSesion(request, datos.clienteEmail);
    const r = await request.post(`${URL_RESERVAS}/appointments`, {
      headers: encabezados(token, datos.tallerId),
      data: {
        bahiaId: datos.bahiaId,
        servicioId: datos.servicioId,
        tecnicoId: datos.tecnicoId,
        inicio: horarioLaboral(10, 3).toISOString(),
      },
    });
    expect(r.status(), await r.text()).toBe(201);
    turnoId = (await r.json()).id;
  });

  test.afterAll(async () => {
    await limpiar(datos);
  });

  test('el admin crea el repuesto y registra la compra que lo deja en el minimo', async ({ page }) => {
    await iniciarSesionEnPanel(page, datos.adminEmail, PASSWORD_DE_PRUEBA);
    await page.goto('/taller?seccion=inventario');

    await page.getByRole('button', { name: 'Nuevo repuesto' }).click();
    await page.getByLabel('Codigo (SKU)').fill(`FIL-${Date.now()}`);
    await page.getByLabel('Nombre', { exact: true }).fill(nombreRepuesto);
    await page.getByLabel('Stock minimo').fill('5');
    await page.getByLabel('Valor base', { exact: true }).fill('25.000');
    await page.getByRole('button', { name: 'Crear repuesto' }).click();
    await expect(page.getByText(`Repuesto ${nombreRepuesto} creado.`)).toBeVisible();

    // 5 unidades de compra: justo en el minimo, dispara la alerta de stock bajo.
    const fila = page.getByRole('listitem').filter({ hasText: nombreRepuesto });
    await fila.getByRole('button', { name: 'Movimiento' }).click();
    await page.getByLabel('Cantidad', { exact: true }).fill('5');
    await page.getByLabel('Costo unitario').fill('15.000');
    await page.getByLabel('Proveedor').fill('Repuestos E2E SAS');
    await page.getByLabel('N.° de factura del proveedor').fill('FE-E2E-001');
    await page.getByRole('button', { name: 'Registrar' }).click();
    await expect(page.getByText(`Stock de ${nombreRepuesto}: 5 unidad.`)).toBeVisible();
    await expect(
      page.getByText(`${nombreRepuesto} esta en o por debajo del stock minimo`),
    ).toBeVisible();
  });

  test('el tecnico usa el repuesto en su propio turno', async ({ page }) => {
    await iniciarSesionEnPanel(page, datos.tecnicoEmail, PASSWORD_DE_PRUEBA);
    await page.goto(`/turnos/${turnoId}`);

    await expect(page.getByRole('heading', { name: 'Repuestos usados' })).toBeVisible();
    await page.getByRole('button', { name: 'Agregar repuesto' }).click();
    // Por value, no por el texto de la opcion: ese texto lleva el precio
    // formateado (moneda con Intl), y comparar el string exacto seria
    // fragil por un espacio angosto que no se ve igual al escribirlo aca.
    const opcion = page.locator('option', { hasText: nombreRepuesto });
    await page.getByLabel('Repuesto').selectOption(await opcion.getAttribute('value'));
    await page.getByLabel('Cantidad', { exact: true }).fill('2');
    await page.getByRole('button', { name: 'Registrar' }).click();

    await expect(page.getByRole('list', { name: 'Repuestos usados' })).toContainText(
      `2 unidad de ${nombreRepuesto}`,
    );
  });

  test('el kardex del admin muestra la compra y la salida del tecnico', async ({ page }) => {
    await iniciarSesionEnPanel(page, datos.adminEmail, PASSWORD_DE_PRUEBA);
    await page.goto('/taller?seccion=inventario');
    const fila = page.getByRole('listitem').filter({ hasText: nombreRepuesto });
    // 5 compradas - 2 usadas por el tecnico = 3.
    await expect(fila.getByText('Stock', { exact: false })).toContainText('3');
    await fila.getByRole('button', { name: 'Kardex' }).click();
    await expect(page.getByRole('heading', { name: `Kardex de ${nombreRepuesto}` })).toBeVisible();
    const filas = page.locator('tbody tr');
    await expect(filas).toHaveCount(2);
    await expect(filas.nth(0)).toContainText('Entrada (compra)');
    await expect(filas.nth(1)).toContainText('Salida');
  });
});
