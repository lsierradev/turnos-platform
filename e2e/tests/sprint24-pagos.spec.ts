import { expect, test } from '@playwright/test';
import { URL_RESERVAS } from '../playwright.config';
import {
  DatosSembrados,
  exigirAnticipo,
  horarioLaboral,
  limpiar,
  PASSWORD_DE_PRUEBA,
  sembrar,
} from '../fixtures/datos-de-prueba';
import { encabezados, iniciarSesion } from '../fixtures/sesion';
import { iniciarSesionEnPanel } from '../fixtures/ui';

/**
 * Sprint 24 - Pagos, contra los servicios reales. El taller de la corrida
 * NO tiene Wompi configurado: el anticipo no vence y se cobra en el
 * mostrador. El cobro en linea (firma, eventos, conciliacion, devoluciones)
 * lo cubre la prueba de integracion de reservas-service con Wompi simulado.
 */
test.describe.configure({ mode: 'serial' });

test.describe('Pagos en el mostrador', () => {
  let datos: DatosSembrados;
  let turnoId: string;

  test.beforeAll(async ({ request }) => {
    datos = await sembrar();
    await exigirAnticipo(datos.servicioId, 50);
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
    const turno = await r.json();
    turnoId = turno.id;
    // Sin Wompi: pendiente, pero sin vencimiento.
    expect(turno).toMatchObject({ anticipoEstado: 'pendiente', anticipoVenceEn: null });
  });

  test.afterAll(async () => {
    await limpiar(datos);
  });

  test('el cliente ve que falta el anticipo y que se paga en el taller', async ({ page }) => {
    await iniciarSesionEnPanel(page, datos.clienteEmail, PASSWORD_DE_PRUEBA);
    await page.goto('/mis-turnos');
    await expect(page.getByText('Falta pagar el anticipo para confirmar el turno.')).toBeVisible();
    await expect(page.getByText('Este taller cobra el anticipo en el mostrador.')).toBeVisible();
  });

  test('el admin cobra el anticipo en efectivo desde la orden', async ({ page }) => {
    await iniciarSesionEnPanel(page, datos.adminEmail, PASSWORD_DE_PRUEBA);
    await page.goto(`/turnos/${turnoId}`);
    const pagos = page.getByRole('heading', { name: 'Pagos' });
    await expect(pagos).toBeVisible();
    await page.getByRole('button', { name: 'Registrar cobro' }).click();
    await expect(page.getByText(/Cobro registrado: \$\s?12\.500/)).toBeVisible();
    await expect(page.getByRole('list', { name: 'Pagos del turno' })).toContainText('Efectivo');
  });

  test('con el anticipo pagado, el turno queda confirmado para el cliente', async ({ page }) => {
    await iniciarSesionEnPanel(page, datos.clienteEmail, PASSWORD_DE_PRUEBA);
    await page.goto('/mis-turnos');
    await expect(page.getByText('Anticipo pagado: turno confirmado.')).toBeVisible();
  });

  test('el cuadre del dia muestra el efectivo cobrado', async ({ page }) => {
    await iniciarSesionEnPanel(page, datos.adminEmail, PASSWORD_DE_PRUEBA);
    await page.goto('/taller?seccion=pagos');
    await expect(page.getByRole('list', { name: 'Cobros del dia' })).toContainText('Efectivo');
  });
});
