import { expect, test } from '@playwright/test';
import {
  DatosSembrados,
  fechaISO,
  hoyEnTaller,
  horarioLaboral,
  limpiar,
  PASSWORD_DE_PRUEBA,
  sembrar,
  sembrarTurnos,
} from '../fixtures/datos-de-prueba';
import { iniciarSesionEnPanel } from '../fixtures/ui';

/**
 * Sprint 21 - Mi taller: configuracion fiscal, precio con IVA para el
 * cliente, horario del taller y baja de un tecnico con reasignacion.
 *
 * Contra los servicios reales. La validacion de credenciales contra
 * Alegra/Wompi no se prueba aca (necesitaria sus sandboxes): la cubren los
 * tests del backend.
 */
test.describe.configure({ mode: 'serial' });

test.describe('Mi taller', () => {
  let datos: DatosSembrados;

  test.beforeAll(async () => {
    datos = await sembrar();
  });

  test.afterAll(async () => {
    await limpiar(datos);
  });

  /** Proxima fecha (despues de pasado manana) que cae en ese dia ISO. */
  function proximo(diaIso: number): string {
    const d = new Date(`${hoyEnTaller()}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 3);
    while (((d.getUTCDay() + 6) % 7) + 1 !== diaIso) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  test('responsable de IVA: el cliente ve y reserva con el precio IVA incluido', async ({ page }) => {
    await iniciarSesionEnPanel(page, datos.adminEmail, PASSWORD_DE_PRUEBA);
    await page.goto('/taller?seccion=fiscal');
    await page.getByLabel('Razon social').fill(`Taller E2E ${datos.sufijo} SAS`);
    await page.getByLabel('NIT').fill('900123456');
    // Un DV equivocado se marca antes de enviar.
    await page.getByLabel('DV').fill('3');
    await expect(page.getByText('el digito de verificacion es 8')).toBeVisible();
    await page.getByLabel('DV').fill('8');
    await page.getByLabel('Direccion').fill('Calle 1 # 2-3');
    await page.getByLabel('Municipio').fill('Bogota');
    await page.getByLabel('Departamento').fill('Cundinamarca');
    await page.getByLabel(/^Responsable de IVA/).check();
    await page.getByRole('button', { name: 'Guardar datos fiscales' }).click();
    await expect(page.getByText('Datos fiscales guardados.')).toBeVisible();

    // En el catalogo: base $ 25.000 + 19% = $ 29.750.
    await page.goto('/taller');
    await expect(page.getByRole('list', { name: 'Servicios' })).toContainText('$ 29.750 IVA incluido');

    // El cliente reserva y ve el precio final.
    await page.getByRole('button', { name: 'Salir' }).first().click();
    const inicio = horarioLaboral(10, 3);
    await iniciarSesionEnPanel(page, datos.clientes[0].email, PASSWORD_DE_PRUEBA);
    await page.goto(`/reservar?fecha=${fechaISO(inicio)}`);
    await page.getByLabel('Taller', { exact: true }).selectOption({ label: datos.tallerNombre });
    await page.getByLabel('Bahia').selectOption({ label: `Bahia E2E ${datos.sufijo}` });
    await page.getByLabel('Servicio').selectOption(datos.servicioId);
    await page.getByLabel('Tecnico').selectOption({ label: `Tecnico E2E ${datos.sufijo}` });
    await page.getByRole('button', { name: '10:00', exact: true }).click();
    await expect(page.getByText('$ 29.750 IVA incluido')).toBeVisible();
    await page.getByRole('button', { name: 'Confirmar reserva' }).click();
    await expect(page.getByRole('heading', { name: 'Turno reservado' })).toBeVisible();
    await expect(page.getByText('$ 29.750 IVA incluido')).toBeVisible();

    await page.goto('/mis-turnos');
    await expect(page.getByText('$ 29.750 IVA incluido').first()).toBeVisible();
  });

  test('un dia que el taller no atiende no ofrece horarios', async ({ page }) => {
    await iniciarSesionEnPanel(page, datos.adminEmail, PASSWORD_DE_PRUEBA);
    await page.goto('/taller?seccion=horario');
    await page.getByLabel('Domingo', { exact: true }).uncheck();
    await page.getByRole('button', { name: 'Guardar horario' }).click();
    await expect(page.getByText('Horario guardado.')).toBeVisible();

    const domingo = proximo(7);
    await page.goto(`/reservar?fecha=${domingo}`);
    await page.getByLabel('Bahia').selectOption({ label: `Bahia E2E ${datos.sufijo}` });
    await page.getByLabel('Servicio').selectOption(datos.servicioId);
    await page.getByLabel('Tecnico').selectOption({ label: `Tecnico E2E ${datos.sufijo}` });
    await expect(page.getByText('El taller no atiende este dia')).toBeVisible();

    // Un festivo propio cierra un dia habil.
    const lunes = proximo(1);
    await page.goto('/taller?seccion=horario');
    await page.getByLabel('Fecha', { exact: true }).fill(lunes);
    await page.getByLabel('Motivo', { exact: true }).fill('Inventario anual');
    await page.getByRole('button', { name: 'Agregar' }).click();
    await expect(page.getByRole('list', { name: 'Dias cerrados' })).toContainText('Inventario anual');

    await page.goto(`/reservar?fecha=${lunes}`);
    await page.getByLabel('Bahia').selectOption({ label: `Bahia E2E ${datos.sufijo}` });
    await page.getByLabel('Servicio').selectOption(datos.servicioId);
    await page.getByLabel('Tecnico').selectOption({ label: `Tecnico E2E ${datos.sufijo}` });
    await expect(page.getByText('Inventario anual. Proba otro dia.')).toBeVisible();
  });

  test('dar de baja a un tecnico deja sus turnos para reasignar en el panel', async ({ page }) => {
    // Un turno que viene, asignado al tecnico que se va.
    const inicio = horarioLaboral(15, 4);
    await sembrarTurnos(datos, [{ inicio, estado: 'programado' }]);

    await iniciarSesionEnPanel(page, datos.adminEmail, PASSWORD_DE_PRUEBA);
    await page.goto('/taller?seccion=tecnicos');
    await page.getByRole('button', { name: `Dar de baja a Tecnico E2E ${datos.sufijo}` }).click();
    await page.getByRole('button', { name: 'Confirmar baja' }).click();
    // El sembrado y el que reservo el cliente en el primer test.
    await expect(page.getByText(/2 turnos quedaron sin tecnico/)).toBeVisible();
    await expect(page.getByRole('list', { name: 'Tecnicos' })).toContainText('Dado de baja');

    await page.getByRole('link', { name: 'reasignalos en el Panel' }).click();
    const aviso = page.getByRole('region', { name: /sin tecnico$/ });
    await expect(aviso).toHaveAccessibleName('2 turnos sin tecnico');
    for (const restantes of ['1 turno sin tecnico', null]) {
      await aviso.getByRole('combobox').first().selectOption({ label: `Otro tecnico E2E ${datos.sufijo}` });
      await aviso.getByRole('button', { name: 'Asignar' }).first().click();
      if (restantes) await expect(aviso).toHaveAccessibleName(restantes);
    }
    await expect(aviso).toBeHidden();
  });
});
