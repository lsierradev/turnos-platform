import { expect, test } from '@playwright/test';
import {
  DatosSembrados,
  horarioLaboral,
  limpiar,
  PASSWORD_DE_PRUEBA,
  sembrar,
  sembrarTurnos,
} from '../fixtures/datos-de-prueba';
import { iniciarSesionEnPanel } from '../fixtures/ui';

/**
 * Sprint 22 - Recepcion del vehiculo, ciclo del turno y politica de
 * cancelacion, contra los servicios reales.
 *
 * Los bordes exactos de la ventana (3 h 59 min vs 4 h 01 min) los cubren
 * los tests unitarios y de integracion; aca se recorre lo que ve cada rol.
 */
test.describe.configure({ mode: 'serial' });

test.describe('Recepcion y cancelaciones', () => {
  let datos: DatosSembrados;
  let turnoLejano: string;
  let turnoCercano: string;
  let turnoDeHoy: string;

  test.beforeAll(async () => {
    datos = await sembrar();
    const ahora = Date.now();
    [turnoLejano, turnoCercano, turnoDeHoy] = await sembrarTurnos(datos, [
      // Dentro de la ventana: cancelar es gratis.
      { inicio: horarioLaboral(9, 3), estado: 'programado' },
      // A 2 horas: cancelar suma un strike.
      { inicio: new Date(ahora + 2 * 3_600_000), estado: 'programado' },
      // Empezo hace 10 minutos: el vehiculo esta en el taller.
      { inicio: new Date(ahora - 10 * 60_000), estado: 'programado' },
    ]);
  });

  test.afterAll(async () => {
    await limpiar(datos);
  });

  test('cliente: carga su vehiculo en el perfil', async ({ page }) => {
    await iniciarSesionEnPanel(page, datos.clienteEmail, PASSWORD_DE_PRUEBA);
    await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Mi perfil' }).click();
    await page.getByRole('button', { name: 'Agregar vehiculo' }).click();
    await page.getByLabel('Placa').fill('abc 123');
    await page.getByLabel('Marca').fill('Renault');
    await page.getByLabel('Modelo').fill('Logan');
    await page.getByLabel('Año').fill('2019');
    await page.getByLabel('Kilometraje').fill('45000');
    await page.getByRole('button', { name: 'Agregar vehiculo' }).click();
    await expect(page.getByText('Vehiculo ABC123 agregado.')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Vehiculos' })).toContainText('Renault Logan 2019 · ABC123');
  });

  test('cliente: cancela gratis dentro del plazo y con strike fuera de el', async ({ page }) => {
    await iniciarSesionEnPanel(page, datos.clienteEmail, PASSWORD_DE_PRUEBA);
    await page.goto('/mis-turnos');
    const proximos = page.getByRole('list', { name: 'Turnos proximos' });

    const lejano = proximos.getByRole('listitem').filter({ hasText: 'sin costo hasta' });
    await expect(lejano).toHaveCount(1);
    await lejano.getByRole('button', { name: 'Cancelar turno' }).click();
    await expect(lejano.getByText('¿Cancelar el turno? Es sin costo.')).toBeVisible();
    await lejano.getByRole('button', { name: 'Si, cancelar' }).click();
    await expect(page.getByText('Turno cancelado sin costo.')).toBeVisible();

    const cercano = proximos.getByRole('listitem').filter({ hasText: 'Paso el plazo sin costo' });
    await cercano.getByRole('button', { name: 'Cancelar turno' }).click();
    await expect(cercano.getByText('¿Cancelar igual? Suma un strike.')).toBeVisible();
    await cercano.getByRole('button', { name: 'Si, cancelar' }).click();
    await expect(page.getByText(/Se sumo un strike/)).toBeVisible();
    expect(turnoLejano && turnoCercano).toBeTruthy();
  });

  test('cliente: ve el strike en su perfil y lo reclama', async ({ page }) => {
    await iniciarSesionEnPanel(page, datos.clienteEmail, PASSWORD_DE_PRUEBA);
    await page.goto('/perfil');
    const strikes = page.getByRole('list', { name: 'Strikes' });
    await expect(strikes.getByRole('listitem')).toHaveCount(1);
    await expect(strikes).toContainText('Cancelacion tardia');
    await expect(strikes).toContainText('Vigente');
    await strikes.getByRole('button', { name: 'Reclamar' }).click();
    await page.getByLabel('Que paso').fill('Llame al taller con tiempo para avisar.');
    await page.getByRole('button', { name: 'Enviar reclamo' }).click();
    await expect(strikes).toContainText('Esperando respuesta del taller.');
  });

  test('admin: acepta el reclamo y el strike queda anulado', async ({ page }) => {
    await iniciarSesionEnPanel(page, datos.adminEmail, PASSWORD_DE_PRUEBA);
    await page.goto('/taller?seccion=cancelaciones');
    await expect(page.getByRole('heading', { name: 'Politica de cancelacion' })).toBeVisible();
    const lista = page.getByRole('list', { name: 'Strikes' });
    await expect(lista).toContainText('Llame al taller con tiempo para avisar.');
    await lista.getByRole('button', { name: 'Responder reclamo' }).click();
    await page.getByLabel('Respuesta al cliente').fill('Consta la llamada en el registro del taller.');
    await page.getByRole('button', { name: 'Aceptar y anular strike' }).click();
    await expect(page.getByText('No hay reclamos pendientes')).toBeVisible();
  });

  test('personal: recepcion, aceptacion en el mostrador, atencion, cierre y garantia', async ({ page }) => {
    await iniciarSesionEnPanel(page, datos.adminEmail, PASSWORD_DE_PRUEBA);
    await page.goto(`/turnos/${turnoDeHoy}`);
    await expect(page.getByRole('heading', { name: 'Orden de trabajo', exact: true })).toBeVisible();

    // El cliente cargo un solo vehiculo: viene elegido.
    const recepcion = page.getByRole('form', { name: 'Recepcion del vehiculo' });
    await expect(recepcion.getByRole('combobox')).toHaveValue(/.+/);
    await recepcion.getByLabel('Kilometraje').fill('45210');
    await recepcion.getByLabel('1/4').check();
    await recepcion.getByLabel('Estado del vehiculo').fill('Rayon en la puerta trasera izquierda.');
    await recepcion.getByLabel('Objetos dejados en el vehiculo').fill('Silla de bebe');
    await recepcion.getByRole('button', { name: 'Registrar recepcion' }).click();
    await expect(page.getByRole('heading', { name: /Orden de trabajo N\.° \d+/ })).toBeVisible();
    await expect(page.getByText('45.210 km')).toBeVisible();

    const aceptar = page.getByRole('form', { name: 'Aceptar la recepcion' });
    await aceptar.getByLabel('Nombre de quien entrega').fill('Juan Perez');
    await aceptar.getByLabel('Documento').fill('CC 1020304050');
    await aceptar.getByRole('checkbox').check();
    await aceptar.getByRole('button', { name: 'Aceptar recepcion' }).click();
    await expect(page.getByTestId('recepcion-aceptada')).toContainText('Juan Perez');
    await expect(page.getByRole('button', { name: 'Corregir recepcion' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Iniciar atencion' }).click();
    await page.getByLabel('Notas del tecnico').fill('Cambio de aceite y filtro.');
    await page.getByRole('button', { name: 'Finalizar atencion' }).click();
    await expect(page.getByRole('button', { name: 'Finalizar atencion' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Atendido', exact: true }).click();
    await expect(page.getByText('Turno cerrado como atendido.')).toBeVisible();
    // El servicio sembrado no tiene termino: rige la garantia legal.
    await expect(page.getByTestId('texto-garantia')).toContainText('rige la garantia legal');
  });

  test('cliente: ve la orden aceptada desde "Mis turnos"', async ({ page }) => {
    await iniciarSesionEnPanel(page, datos.clienteEmail, PASSWORD_DE_PRUEBA);
    await page.goto('/mis-turnos');
    await page.getByRole('link', { name: /Ver orden N\.° \d+/ }).click();
    await expect(page.getByTestId('recepcion-aceptada')).toContainText('Juan Perez');
    await expect(page.getByText('Cambio de aceite y filtro.')).toBeVisible();
  });
});
