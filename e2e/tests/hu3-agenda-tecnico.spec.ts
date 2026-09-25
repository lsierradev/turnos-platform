import { expect, test } from '@playwright/test';
import {
  aLasEnTaller,
  DatosSembrados,
  hoyEnTaller,
  limpiar,
  PASSWORD_DE_PRUEBA,
  sembrar,
  sembrarTurnos,
} from '../fixtures/datos-de-prueba';
import { encabezados, iniciarSesion } from '../fixtures/sesion';
import { iniciarSesionEnPanel, tituloDeTarjeta } from '../fixtures/ui';
import { URL_RESERVAS } from '../playwright.config';

/**
 * HU3 - Como tecnico quiero ver mi agenda del dia, ordenada por hora y con
 * la bahia y el servicio de cada turno, para saber que me toca atender.
 *
 * Esta si se prueba por navegador: la vista existe (/agenda/:tecnicoId) y es
 * la interfaz que el tecnico usa de verdad. Desde Sprint 10 el test se
 * loguea COMO EL TECNICO por la pantalla de login, que es exactamente el
 * recorrido de la historia.
 */
test.describe('HU3 - Agenda del tecnico', () => {
  let datos: DatosSembrados;

  // Hoy del taller, que es la fecha que la vista toma por defecto
  // (hoyISO()). Las horas se eligen dentro del horario laboral para que la
  // agenda se parezca a un dia real.
  function hoyALas(hora: number): Date {
    return aLasEnTaller(hoyEnTaller(), hora);
  }

  test.beforeAll(async () => {
    datos = await sembrar();
    // Se siembran en orden inverso a proposito: la vista tiene que
    // mostrarlos ordenados por hora, no en el orden en que se crearon.
    await sembrarTurnos(datos, [
      { inicio: hoyALas(11), estado: 'programado' },
      { inicio: hoyALas(9), estado: 'programado' },
    ]);
  });

  test.afterAll(async () => {
    await limpiar(datos);
  });

  test('muestra los turnos del dia ordenados por hora, con bahia y servicio', async ({
    page,
  }) => {
    await iniciarSesionEnPanel(page, datos.tecnicoEmail, PASSWORD_DE_PRUEBA);
    await page.goto(`/agenda/${datos.tecnicoId}`);

    await expect(tituloDeTarjeta(page, 'Agenda del tecnico')).toBeVisible();

    // Desde Sprint 15 la agenda es una linea de tiempo: cada turno es un
    // item de la lista "Turnos del dia" y su nombre accesible trae horario,
    // servicio, bahia y categoria (el bloque visible puede abreviarlos si
    // el turno es corto).
    const turnos = page
      .getByRole('list', { name: 'Turnos del dia' })
      .getByRole('listitem');
    await expect(turnos).toHaveCount(2);

    // Las horas son del taller (ver lib/dates.ts), asi que no dependen de la
    // zona horaria de la maquina que corre el test.
    await expect(turnos.nth(0)).toHaveAccessibleName(
      `09:00–09:30, Cambio de aceite E2E ${datos.sufijo}, Bahia E2E ${datos.sufijo}, Mecanica`,
    );
    await expect(turnos.nth(1)).toHaveAccessibleName(/^11:00–11:30,/);
  });

  test('navegar a otro dia muestra la agenda vacia', async ({ page }) => {
    await iniciarSesionEnPanel(page, datos.tecnicoEmail, PASSWORD_DE_PRUEBA);
    await page.goto(`/agenda/${datos.tecnicoId}`);
    await expect(
      page.getByRole('list', { name: 'Turnos del dia' }).getByRole('listitem'),
    ).toHaveCount(2);

    await page.getByRole('button', { name: 'Siguiente' }).click();

    // Manana no se sembro nada. Es tambien la prueba de que el filtro por
    // fecha realmente filtra y no devuelve siempre todos los turnos del
    // tecnico.
    await expect(
      page.getByText('Sin turnos para este dia.'),
    ).toBeVisible();
  });

  test('el admin busca al tecnico por nombre y abre su agenda (Sprint 15)', async ({
    page,
  }) => {
    await iniciarSesionEnPanel(page, datos.adminEmail, PASSWORD_DE_PRUEBA);
    await page.goto('/agenda');

    // Busqueda sin tildes ni mayusculas; el sufijo hace unico al tecnico
    // de este run entre los que hayan dejado otras corridas.
    const buscador = page.getByRole('combobox', { name: /Buscar tecnico/ });
    await buscador.fill(datos.sufijo);
    await expect(page.getByRole('option')).not.toHaveCount(0);
    await page
      .getByRole('option')
      .filter({ hasText: datos.tecnicoEmail })
      .click();

    await expect(page).toHaveURL(new RegExp(`/agenda/${datos.tecnicoId}$`));
    await expect(
      page.getByRole('list', { name: 'Turnos del dia' }).getByRole('listitem'),
    ).toHaveCount(2);
  });

  test('la vista semanal muestra el dia con turnos y lleva a ese dia', async ({
    page,
  }) => {
    await iniciarSesionEnPanel(page, datos.tecnicoEmail, PASSWORD_DE_PRUEBA);
    await page.goto(`/agenda/${datos.tecnicoId}`);
    await page.getByRole('button', { name: 'Semana', exact: true }).click();

    await expect(page).toHaveURL(/vista=semana/);
    // La columna de hoy resume los 2 turnos sembrados.
    const hoy = page.getByRole('button', { name: /: 2 turnos\. Ver el dia$/ });
    await expect(hoy).toBeVisible();
    await hoy.click();

    await expect(page).not.toHaveURL(/vista=semana/);
    await expect(
      page.getByRole('list', { name: 'Turnos del dia' }).getByRole('listitem'),
    ).toHaveCount(2);
  });

  test('un tecnico no puede leer la agenda de otro tecnico', async ({
    request,
  }) => {
    // La restriccion por rol no alcanza para esta ruta: un @Roles(TECNICO)
    // a secas dejaria que cualquier tecnico leyera la agenda de todos los
    // demas cambiando el id de la URL. Lo que decide es la pertenencia.
    const tokenOtroTecnico = await iniciarSesion(
      request,
      `tecnico2-e2e-${datos.sufijo}@turnos.dev`,
    );

    const ajena = await request.get(
      `${URL_RESERVAS}/technicians/${datos.tecnicoId}/agenda`,
      { headers: encabezados(tokenOtroTecnico, datos.tallerId) },
    );
    expect(ajena.status()).toBe(403);

    const propia = await request.get(
      `${URL_RESERVAS}/technicians/${datos.otroTecnicoId}/agenda`,
      { headers: encabezados(tokenOtroTecnico, datos.tallerId) },
    );
    expect(propia.status()).toBe(200);
  });

  test('un tecnico inexistente no deja la vista colgada cargando', async ({
    page,
  }) => {
    // El backend responde 404 para un id que no es un tecnico. La vista
    // tiene que mostrar ese error, no un skeleton eterno (es el hallazgo 1
    // de UX-NOTES.md, que aplica al caso de id vacio).
    // Como admin: para un tecnico, un id ajeno daria 403 en vez de 404.
    await iniciarSesionEnPanel(page, datos.adminEmail, PASSWORD_DE_PRUEBA);
    await page.goto('/agenda/00000000-0000-4000-8000-0000000000ff');

    await expect(
      page.locator('.text-destructive').first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});
