import { expect, test } from '@playwright/test';
import {
  DatosSembrados,
  limpiar,
  PASSWORD_DE_PRUEBA,
  sembrar,
} from '../fixtures/datos-de-prueba';
import { iniciarSesionEnPanel } from '../fixtures/ui';

/**
 * La puerta de entrada al panel (Sprint 10).
 *
 * No es una de las 4 Historias de Usuario: es la garantia transversal de la
 * que dependen todas. Hasta Sprint 10 el panel no tenia login y la sesion
 * era un token horneado en el bundle, asi que estas comprobaciones no
 * existian ni podian existir.
 */
test.describe('Acceso al panel', () => {
  let datos: DatosSembrados;

  test.beforeAll(async () => {
    datos = await sembrar();
  });

  test.afterAll(async () => {
    await limpiar(datos);
  });

  test('una ruta privada redirige al login y despues devuelve a donde ibas', async ({
    page,
  }) => {
    await page.goto('/dashboard');

    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel('Correo').fill(datos.adminEmail);
    await page.getByLabel('Contraseña').fill(PASSWORD_DE_PRUEBA);
    await page.getByRole('button', { name: 'Ingresar' }).click();

    // Vuelve a /dashboard, no al inicio: si alguien guardo el link de una
    // vista, loguearse tiene que llevarlo ahi.
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('una contrasenia incorrecta muestra el error y no deja entrar', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel('Correo').fill(datos.adminEmail);
    await page.getByLabel('Contraseña').fill('password-incorrecta');
    await page.getByRole('button', { name: 'Ingresar' }).click();

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('salir corta la sesion y vuelve a pedir login', async ({ page }) => {
    await iniciarSesionEnPanel(page, datos.adminEmail, PASSWORD_DE_PRUEBA);
    await page.goto('/dashboard');

    await page.getByRole('button', { name: 'Salir' }).click();
    await expect(page).toHaveURL(/\/login$/);

    // Y la sesion quedo realmente cortada: volver a la ruta no reentra.
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('la sesion sobrevive a recargar la pagina', async ({ page }) => {
    await iniciarSesionEnPanel(page, datos.adminEmail, PASSWORD_DE_PRUEBA);
    await page.goto('/dashboard');

    await page.reload();

    // Si el estado de sesion se resolviera en un efecto en vez de leerse de
    // forma sincrona al montar, aca se veria un rebote al login.
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('un tecnico no ve las opciones de administrador', async ({ page }) => {
    await iniciarSesionEnPanel(page, datos.tecnicoEmail, PASSWORD_DE_PRUEBA);

    await expect(
      page.getByRole('button', { name: 'Ver mi agenda de hoy' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Dashboard de indicadores' }),
    ).toHaveCount(0);
  });

  test('un cliente entra y solo puede reservar', async ({ page }) => {
    await iniciarSesionEnPanel(page, datos.clienteEmail, PASSWORD_DE_PRUEBA);

    // Desde Sprint 17 la reserva es la unica vista del cliente: ni agenda,
    // ni panel, ni dashboard en la navegacion.
    await expect(
      page.getByRole('button', { name: 'Reservar un turno' }),
    ).toBeVisible();
    // Hay dos <nav> (lateral y barra inferior); el oculto por CSS no cuenta
    // para getByRole.
    const nav = page.getByRole('navigation', { name: 'Principal' });
    await expect(nav.getByRole('link', { name: 'Reservar' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Agenda' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveCount(0);
  });

  test('un cliente que fuerza la URL del dashboard recibe un error, no los datos', async ({
    page,
  }) => {
    await iniciarSesionEnPanel(page, datos.clienteEmail, PASSWORD_DE_PRUEBA);
    await page.goto('/dashboard');

    // La guarda de ruta lo deja pasar (tiene sesion), pero el backend
    // responde 403 y la vista muestra el mensaje de permisos. Esa es la
    // division correcta: quien autoriza es el servidor, no el frontend.
    //
    // Se busca "permiso" y no la frase entera porque el texto puede venir
    // del backend ("No tenes permiso para esta operacion...") o del
    // fallback del frontend ("Tu usuario no tiene permiso..."): api-client
    // prefiere el mensaje del servidor cuando viene, y el filtro global
    // siempre lo manda.
    await expect(page.getByText(/permiso/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
