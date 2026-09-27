import { expect, test } from '@playwright/test';
import { URL_USUARIOS } from '../playwright.config';
import {
  borrarAceptaciones,
  DatosSembrados,
  fechaISO,
  horarioLaboral,
  limpiar,
  PASSWORD_DE_PRUEBA,
  sembrar,
} from '../fixtures/datos-de-prueba';
import { encabezados, iniciarSesion } from '../fixtures/sesion';
import { iniciarSesionEnPanel } from '../fixtures/ui';

/**
 * Sprint 23 - Documentos legales y consentimiento, contra los servicios
 * reales: la aceptacion al entrar, los derechos del titular y las
 * condiciones del taller al reservar.
 */
test.describe.configure({ mode: 'serial' });

const CONDICIONES = [
  '# Condiciones del servicio',
  '',
  '## Precios',
  '',
  'Todos los precios incluyen IVA. El anticipo se entrega como arras y se devuelve completo si',
  'cancela con al menos 4 horas de anticipacion o si el taller cancela el turno.',
  '',
  '## Strikes',
  '',
  '- Cancelar tarde o no asistir suma un strike.',
  '- Cada strike vence a los 12 meses y se puede reclamar desde Mi perfil.',
].join('\n');

test.describe('Legal y consentimiento', () => {
  let datos: DatosSembrados;
  // Un cliente propio del spec: se le borran las aceptaciones sembradas.
  let cliente: { id: string; email: string };

  test.beforeAll(async () => {
    datos = await sembrar();
    cliente = datos.clientes[3];
    await borrarAceptaciones(cliente.id);
  });

  test.afterAll(async () => {
    await limpiar(datos);
  });

  test('sin aceptar la politica y la autorizacion no se entra al panel', async ({ page, request }) => {
    await iniciarSesionEnPanel(page, cliente.email, PASSWORD_DE_PRUEBA);
    await expect(page.getByRole('heading', { name: 'Antes de continuar' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Principal' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Aceptar y continuar' }).click();
    await expect(page.getByText('Marcá cada casilla para continuar.')).toBeVisible();

    await page.getByLabel('Leí la Política de Tratamiento de Datos Personales.').check();
    await page.getByLabel(/Autorizo de manera previa, expresa e informada/).check();
    await page.getByRole('button', { name: 'Aceptar y continuar' }).click();
    await expect(page.getByRole('navigation', { name: 'Principal' })).toBeVisible();

    // Quedo registrado: version, canal e IP.
    const token = await iniciarSesion(request, cliente.email);
    const mias = await (
      await request.get(`${URL_USUARIOS}/legal/aceptaciones/mias`, { headers: encabezados(token) })
    ).json();
    expect(mias.map((a: { documento: string }) => a.documento).sort()).toEqual([
      'autorizacion_datos',
      'politica_datos',
    ]);
    expect(mias[0]).toMatchObject({ version: 1, canal: 'web' });
    expect(mias[0].ip).toBeTruthy();
  });

  test('el titular corrige sus datos y ve lo que acepto', async ({ page }) => {
    await iniciarSesionEnPanel(page, cliente.email, PASSWORD_DE_PRUEBA);
    await page.getByRole('link', { name: /^Mis datos/ }).click();
    await expect(page.getByRole('heading', { name: 'Mis datos', level: 1 })).toBeVisible();

    await page.getByLabel('Ciudad').fill('Barranquilla');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Datos actualizados.')).toBeVisible();
    await expect(page.getByText('Corregiste tus datos (ciudad)')).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Política de Tratamiento de Datos Personales' }),
    ).toBeVisible();
  });

  test('el admin publica las condiciones del taller', async ({ page }) => {
    await iniciarSesionEnPanel(page, datos.adminEmail, PASSWORD_DE_PRUEBA);
    await page.goto('/taller?seccion=condiciones');
    // La plantilla sin datos fiscales no se puede publicar tal cual.
    await expect(page.getByRole('button', { name: 'Publicar versión 1' })).toBeDisabled();

    await page.getByLabel('Texto (Markdown)').fill(CONDICIONES);
    await page.getByRole('button', { name: 'Publicar versión 1' }).click();
    await expect(page.getByText('Versión 1 publicada.')).toBeVisible();
  });

  test('el cliente acepta las condiciones al reservar', async ({ page }) => {
    const inicio = horarioLaboral(10, 4);
    await iniciarSesionEnPanel(page, cliente.email, PASSWORD_DE_PRUEBA);
    await page.goto(`/reservar?fecha=${fechaISO(inicio)}`);
    await page.getByLabel('Taller', { exact: true }).selectOption({ label: datos.tallerNombre });
    await page.getByLabel('Bahia').selectOption({ label: `Bahia E2E ${datos.sufijo}` });
    await page.getByLabel('Servicio').selectOption(datos.servicioId);
    await page.getByLabel('Tecnico').selectOption({ label: `Tecnico E2E ${datos.sufijo}` });
    await page.getByRole('button', { name: '10:00', exact: true }).click();

    await page.getByRole('button', { name: 'Confirmar reserva' }).click();
    await expect(page.getByText('Para reservar hay que aceptar las condiciones del taller.')).toBeVisible();

    await page.getByLabel(/Leí y acepto las/).check();
    await page.getByRole('button', { name: 'Confirmar reserva' }).click();
    await expect(page.getByRole('heading', { name: 'Turno reservado' })).toBeVisible();
  });
});
