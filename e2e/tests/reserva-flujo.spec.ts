import { APIRequestContext, expect, Page, test } from '@playwright/test';
import {
  borrarUsuariosPorEmail,
  DatosSembrados,
  fechaISO,
  horarioLaboral,
  limpiar,
  PASSWORD_DE_PRUEBA,
  sembrar,
} from '../fixtures/datos-de-prueba';
import { encabezados, iniciarSesion } from '../fixtures/sesion';
import { iniciarSesionEnPanel } from '../fixtures/ui';
import { URL_RESERVAS, URL_USUARIOS } from '../playwright.config';

/**
 * Sprint 17 - Flujo de reserva en admin-web (/reservar).
 *
 * HU1 y HU2 ya se prueban a nivel API; esto recorre lo mismo por la
 * pantalla: seleccion encadenada, confirmacion sin UI optimista y el 409
 * con sugerencias que reintentan.
 *
 * El navegador corre en Tokio a proposito: el taller esta en Bogota (UTC-5)
 * y la pantalla tiene que mostrar 09:00 para las 09:00 del taller, no las
 * 23:00 de Tokio.
 */
test.use({ timezoneId: 'Asia/Tokyo' });

test.describe('Reserva desde el panel', () => {
  let datos: DatosSembrados;

  test.beforeAll(async () => {
    datos = await sembrar();
  });

  // Cliente que da de alta el admin por la pantalla: no es de sembrar().
  let emailClienteNuevo: string;

  test.afterAll(async () => {
    await limpiar(datos);
    if (emailClienteNuevo) await borrarUsuariosPorEmail([emailClienteNuevo]);
  });

  async function abrirFormulario(page: Page, email: string, fecha: string) {
    await iniciarSesionEnPanel(page, email, PASSWORD_DE_PRUEBA);
    await page.goto(`/reservar?fecha=${fecha}`);

    // Encadenado: el servicio y el tecnico esperan a lo anterior.
    await expect(page.getByLabel('Servicio')).toBeDisabled();
    await page.getByLabel('Bahia').selectOption({ label: `Bahia E2E ${datos.sufijo}` });
    await expect(page.getByLabel('Tecnico')).toBeDisabled();
    await page
      .getByLabel('Servicio')
      .selectOption({ label: `Cambio de aceite E2E ${datos.sufijo} · 30 min` });
    await page.getByLabel('Tecnico').selectOption({ label: `Tecnico E2E ${datos.sufijo}` });

    // Primer horario de la jornada en hora del taller.
    await expect(
      page.getByRole('group', { name: 'Horarios de la mañana' }).getByRole('button').first(),
    ).toHaveText('08:00');
  }

  test('camino feliz: elige, confirma y ve el turno recien con el 201', async ({
    page,
    request,
  }) => {
    const inicio = horarioLaboral(9);
    await abrirFormulario(page, datos.clientes[0].email, fechaISO(inicio));

    await page.getByRole('button', { name: '09:00', exact: true }).click();
    await expect(page.getByText('09:00–09:30')).toBeVisible();

    // Se retiene el POST para ver el estado intermedio: sin UI optimista,
    // el boton queda deshabilitado con spinner y no hay confirmacion.
    let liberar!: () => void;
    const retenido = new Promise<void>((r) => (liberar = r));
    await page.route('**/appointments', async (route) => {
      await retenido;
      await route.continue();
    });

    const confirmar = page.getByRole('button', { name: 'Confirmar reserva' });
    await confirmar.click();

    const enVuelo = page.getByRole('button', { name: 'Reservando…' });
    await expect(enVuelo).toBeDisabled();
    await expect(page.getByLabel('Bahia')).toBeDisabled();
    await expect(page.getByRole('heading', { name: 'Turno reservado' })).toHaveCount(0);

    liberar();

    await expect(page.getByRole('heading', { name: 'Turno reservado' })).toBeVisible();
    await expect(page.getByText('09:00–09:30')).toBeVisible();

    // Quedo guardado de verdad, a nombre del cliente y a las 09:00 del taller.
    const tokenAdmin = await iniciarSesion(request, datos.adminEmail);
    const agenda = await request.get(
      `${URL_RESERVAS}/technicians/${datos.tecnicoId}/agenda?date=${fechaISO(inicio)}`,
      { headers: encabezados(tokenAdmin) },
    );
    const turnos = await agenda.json();
    expect(turnos).toHaveLength(1);
    expect(turnos[0].usuarioId).toBe(datos.clientes[0].id);
    expect(new Date(turnos[0].rangoTiempo.inicio).toISOString()).toBe(inicio.toISOString());
  });

  test('conflicto: el 409 ofrece las sugerencias y una reintenta con exito', async ({
    page,
    request,
  }) => {
    const inicio = horarioLaboral(10, 3);
    await abrirFormulario(page, datos.clientes[1].email, fechaISO(inicio));
    await expect(page.getByRole('button', { name: '10:00', exact: true })).toBeVisible();

    // Otro cliente toma las 10:00 de la bahia mientras este mira la grilla.
    // Con OTRO tecnico, para que el choque sea solo el de la bahia.
    const tokenOtro = await iniciarSesion(request, datos.clientes[2].email);
    const ganador = await request.post(`${URL_RESERVAS}/appointments`, {
      headers: encabezados(tokenOtro),
      data: {
        bahiaId: datos.bahiaId,
        servicioId: datos.servicioId,
        tecnicoId: datos.otroTecnicoId,
        inicio: inicio.toISOString(),
      },
    });
    expect(ganador.status(), await ganador.text()).toBe(201);

    await page.getByRole('button', { name: '10:00', exact: true }).click();
    await page.getByRole('button', { name: 'Confirmar reserva' }).click();

    const alerta = page.getByRole('alert');
    await expect(alerta).toContainText('El horario de las 10:00 ya no esta disponible');
    await expect(alerta).toContainText(/bahia/i);

    // Las del backend, en orden de cercania y en hora del taller: 09:30 y
    // 10:30 quedan a 30 min (empate -> la mas temprana), 09:15 a 45.
    const alternativas = alerta.getByRole('button', { name: /en su lugar$/ });
    await expect(alternativas).toHaveText([
      'Reservar a las 09:30 en su lugar',
      'Reservar a las 10:30 en su lugar',
      'Reservar a las 09:15 en su lugar',
    ]);

    // La grilla se refresco: las 10:00 ya no se ofrecen.
    await expect(page.getByRole('button', { name: '10:00', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Confirmar reserva' })).toBeDisabled();

    await alternativas.first().click();

    await expect(page.getByRole('heading', { name: 'Turno reservado' })).toBeVisible();
    await expect(page.getByText('09:30–10:00')).toBeVisible();
  });

  async function turnosDelDia(request: APIRequestContext, dia: Date) {
    const tokenAdmin = await iniciarSesion(request, datos.adminEmail);
    const agenda = await request.get(
      `${URL_RESERVAS}/technicians/${datos.tecnicoId}/agenda?date=${fechaISO(dia)}`,
      { headers: encabezados(tokenAdmin) },
    );
    return (await agenda.json()) as { usuarioId: string; rangoTiempo: { inicio: string } }[];
  }

  test('un admin reserva a nombre de un cliente existente', async ({ page, request }) => {
    const inicio = horarioLaboral(11, 4);
    const cliente = datos.clientes[3];
    await abrirFormulario(page, datos.adminEmail, fechaISO(inicio));

    await page
      .getByRole('combobox', { name: 'Buscar cliente por nombre o email' })
      .fill(cliente.email);
    await page.getByRole('option').first().click();
    await expect(page.getByTestId('cliente-elegido')).toContainText(cliente.email);

    await page.getByRole('button', { name: '11:00', exact: true }).click();
    await page.getByRole('button', { name: 'Confirmar reserva' }).click();
    await expect(page.getByRole('heading', { name: 'Turno reservado' })).toBeVisible();

    // A nombre del cliente, no del admin que lo cargo.
    const turnos = await turnosDelDia(request, inicio);
    expect(turnos).toHaveLength(1);
    expect(turnos[0].usuarioId).toBe(cliente.id);
  });

  test('un admin da de alta un cliente nuevo y reserva a su nombre', async ({
    page,
    request,
  }) => {
    const inicio = horarioLaboral(11, 5);
    emailClienteNuevo = `nuevo-e2e-${datos.sufijo}@turnos.dev`;
    await abrirFormulario(page, datos.adminEmail, fechaISO(inicio));

    await page.getByRole('button', { name: 'Cliente nuevo' }).click();
    await page.getByLabel('Nombre completo').fill('Cliente Nuevo E2E');
    await page.getByLabel('Correo', { exact: true }).fill(emailClienteNuevo);
    await page.getByLabel('Telefono (opcional)').fill('+57 300 000 0000');
    await page.getByLabel('Ciudad').fill('Medellin');

    await page.getByRole('button', { name: '11:00', exact: true }).click();
    await page.getByRole('button', { name: 'Confirmar reserva' }).click();
    await expect(page.getByRole('heading', { name: 'Turno reservado' })).toBeVisible();

    const registrado = page.getByTestId('cliente-registrado');
    await expect(registrado).toContainText(emailClienteNuevo);
    await expect(registrado).toContainText('Medellin');

    // Quedo guardado con sus datos de perfil (el telefono, cifrado en la
    // base, vuelve descifrado)...
    const tokenAdmin = await iniciarSesion(request, datos.adminEmail);
    const clientes = await (
      await request.get(`${URL_USUARIOS}/usuarios?rol=cliente`, {
        headers: encabezados(tokenAdmin),
      })
    ).json();
    const nuevo = clientes.find((c: { email: string }) => c.email === emailClienteNuevo);
    expect(nuevo).toMatchObject({
      nombre: 'Cliente Nuevo E2E',
      telefono: '+57 300 000 0000',
      ciudad: 'Medellin',
    });

    // ...y el turno es suyo.
    const turnos = await turnosDelDia(request, inicio);
    expect(turnos).toHaveLength(1);
    expect(turnos[0].usuarioId).toBe(nuevo.id);
  });
});
