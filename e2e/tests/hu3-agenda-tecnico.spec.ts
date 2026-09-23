import { expect, test } from '@playwright/test';
import {
  DatosSembrados,
  limpiar,
  sembrar,
  sembrarTurnos,
} from '../fixtures/datos-de-prueba';
import { encabezados, iniciarSesion } from '../fixtures/sesion';
import { tituloDeTarjeta } from '../fixtures/ui';
import { URL_RESERVAS } from '../playwright.config';

/**
 * HU3 - Como tecnico quiero ver mi agenda del dia, ordenada por hora y con
 * la bahia y el servicio de cada turno, para saber que me toca atender.
 *
 * Esta si se prueba por navegador: la vista existe (/agenda/:tecnicoId) y es
 * la interfaz que el tecnico usa de verdad. La sesion la aporta el token de
 * desarrollo que inyecta playwright.config.ts (admin-web todavia no tiene
 * login).
 */
test.describe('HU3 - Agenda del tecnico', () => {
  let datos: DatosSembrados;

  // Hoy en UTC, que es la fecha que la vista toma por defecto (hoyISO()).
  // Las horas se eligen dentro del horario laboral para que la agenda se
  // parezca a un dia real.
  function hoyALas(hora: number): Date {
    const fecha = new Date();
    fecha.setUTCHours(hora, 0, 0, 0);
    return fecha;
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
    await page.goto(`/agenda/${datos.tecnicoId}`);

    await expect(tituloDeTarjeta(page, 'Agenda del tecnico')).toBeVisible();

    const filas = page.getByRole('row');
    // +1 por la fila de encabezados.
    await expect(filas).toHaveCount(3);

    // formatearHora() imprime en UTC (ver lib/dates.ts), asi que estos
    // valores no dependen de la zona horaria de la maquina que corre el test.
    const primera = filas.nth(1);
    await expect(primera).toContainText('09:00');
    await expect(primera).toContainText('09:30');
    await expect(primera).toContainText(`Bahia E2E ${datos.sufijo}`);
    await expect(primera).toContainText('Cambio de aceite E2E');
    await expect(primera).toContainText('Mecanica');

    await expect(filas.nth(2)).toContainText('11:00');
  });

  test('navegar a otro dia muestra la agenda vacia', async ({ page }) => {
    await page.goto(`/agenda/${datos.tecnicoId}`);
    await expect(page.getByRole('row')).toHaveCount(3);

    await page.getByRole('button', { name: 'Siguiente' }).click();

    // Manana no se sembro nada. Es tambien la prueba de que el filtro por
    // fecha realmente filtra y no devuelve siempre todos los turnos del
    // tecnico.
    await expect(
      page.getByText('Sin turnos para este dia.'),
    ).toBeVisible();
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
      { headers: encabezados(tokenOtroTecnico) },
    );
    expect(ajena.status()).toBe(403);

    const propia = await request.get(
      `${URL_RESERVAS}/technicians/${datos.otroTecnicoId}/agenda`,
      { headers: encabezados(tokenOtroTecnico) },
    );
    expect(propia.status()).toBe(200);
  });

  test('un tecnico inexistente no deja la vista colgada cargando', async ({
    page,
  }) => {
    // El backend responde 404 para un id que no es un tecnico. La vista
    // tiene que mostrar ese error, no un skeleton eterno (es el hallazgo 1
    // de UX-NOTES.md, que aplica al caso de id vacio).
    await page.goto('/agenda/00000000-0000-4000-8000-0000000000ff');

    await expect(
      page.locator('.text-destructive').first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});
