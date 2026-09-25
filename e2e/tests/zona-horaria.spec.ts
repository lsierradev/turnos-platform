import { expect, test } from '@playwright/test';
import {
  DatosSembrados,
  fechaISO,
  horaEnTaller,
  horarioLaboral,
  limpiar,
  PASSWORD_DE_PRUEBA,
  sembrar,
} from '../fixtures/datos-de-prueba';
import { encabezados, iniciarSesion } from '../fixtures/sesion';
import { iniciarSesionEnPanel, tituloDeTarjeta } from '../fixtures/ui';
import { URL_RESERVAS } from '../playwright.config';

/**
 * Sprint 12 - Zona horaria del taller (TZ_NEGOCIO, default America/Bogota).
 *
 * Hasta Sprint 11 todo era UTC: un turno de las 14:00 en Bogota se validaba
 * contra 8-18 UTC y la agenda lo mostraba como 19:00. Este es el recorrido
 * completo: se reserva por la API a las 14:00 del taller, y la agenda del
 * tecnico en el navegador lo muestra a las 14:00.
 *
 * El navegador corre en Tokio A PROPOSITO: el panel tiene que mostrar la
 * hora del taller, no la del navegador ni la de UTC. Con la zona de la
 * maquina (Bogota, en el entorno de desarrollo) el test pasaria aunque el
 * front formateara con la zona local.
 */
test.describe('Zona horaria del taller', () => {
  test.use({ timezoneId: 'Asia/Tokyo' });

  let datos: DatosSembrados;

  test.beforeAll(async () => {
    datos = await sembrar();
  });

  test.afterAll(async () => {
    await limpiar(datos);
  });

  test('un turno reservado a las 14:00 locales se acepta y se muestra a las 14:00', async ({
    page,
    request,
  }) => {
    // Manana y no hoy: hoy a las 14:00 puede ya haber pasado cuando corre
    // la suite, y create() rechaza reservas en el pasado.
    const inicio = horarioLaboral(14, 1);
    expect(horaEnTaller(inicio)).toBe('14:00');

    const token = await iniciarSesion(request, datos.clienteEmail);
    const respuesta = await request.post(`${URL_RESERVAS}/appointments`, {
      headers: encabezados(token, datos.tallerId),
      data: {
        bahiaId: datos.bahiaId,
        servicioId: datos.servicioId,
        tecnicoId: datos.tecnicoId,
        // En UTC (19:00Z), como lo manda cualquier cliente con
        // toISOString(): la hora de pared la define TZ_NEGOCIO, no el sufijo.
        inicio: inicio.toISOString(),
      },
    });
    expect(respuesta.status(), await respuesta.text()).toBe(201);

    await iniciarSesionEnPanel(page, datos.tecnicoEmail, PASSWORD_DE_PRUEBA);
    await page.goto(`/agenda/${datos.tecnicoId}`);
    await expect(tituloDeTarjeta(page, 'Agenda del tecnico')).toBeVisible();

    await page.getByRole('button', { name: 'Siguiente' }).click();
    await expect(page.getByText(fechaISO(inicio))).toBeVisible();

    const turnos = page
      .getByRole('list', { name: 'Turnos del dia' })
      .getByRole('listitem');
    await expect(turnos).toHaveCount(1);
    const fin = horaEnTaller(
      new Date(inicio.getTime() + datos.duracionMinutos * 60_000),
    );
    await expect(turnos.first()).toHaveAccessibleName(
      new RegExp(`^14:00–${fin},`),
    );
    // Y el bloque visible arranca a las 14:00 en la linea de tiempo.
    await expect(turnos.first()).toContainText('14:00');
  });
});
