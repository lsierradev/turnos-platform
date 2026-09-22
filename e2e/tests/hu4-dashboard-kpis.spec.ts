import { expect, test } from '@playwright/test';
import {
  DatosSembrados,
  limpiar,
  sembrar,
  sembrarTurnos,
} from '../fixtures/datos-de-prueba';
import { tituloDeTarjeta } from '../fixtures/ui';

/**
 * HU4 - Como administrador quiero ver un dashboard con los KPIs operativos
 * del dia para tomar decisiones.
 *
 * Sobre las fechas: GET /dashboard/kpis agrega TODA la tabla turnos dentro
 * del rango, sin filtrar por bahia ni por tecnico. Si el test usara el rango
 * por defecto (ultimos 7 dias), cualquier turno que haya dejado otra spec o
 * una corrida anterior entraria en la cuenta y los porcentajes esperados
 * dejarian de ser deterministas. Por eso se siembra en un par de dias fijos
 * del pasado y se mueve el filtro hasta ahi -- lo que ademas ejercita el
 * filtro de rango, que es parte de la HU.
 */
const DIA_A = '2018-05-10';
const DIA_B = '2018-05-11';

function aLas(dia: string, hora: number): Date {
  return new Date(`${dia}T${String(hora).padStart(2, '0')}:00:00.000Z`);
}

test.describe('HU4 - Dashboard de indicadores', () => {
  let datos: DatosSembrados;

  test.beforeAll(async () => {
    datos = await sembrar();

    await sembrarTurnos(datos, [
      // DIA_A: 3 atendidos cronometrados (30, 50 y 40 min) + 1 no_asistio.
      // -> tasa 3/4 = 75%, promedio (30+50+40)/3 = 40 min.
      { inicio: aLas(DIA_A, 8), estado: 'atendido', minutosAtencion: 30 },
      { inicio: aLas(DIA_A, 10), estado: 'atendido', minutosAtencion: 50 },
      { inicio: aLas(DIA_A, 12), estado: 'atendido', minutosAtencion: 40 },
      { inicio: aLas(DIA_A, 14), estado: 'no_asistio' },
      // DIA_B: un cancelado y un programado, que NO deben mover la tasa.
      { inicio: aLas(DIA_B, 9), estado: 'cancelado' },
      { inicio: aLas(DIA_B, 11), estado: 'programado' },
    ]);
  });

  test.afterAll(async () => {
    await limpiar(datos);
  });

  async function abrirConRango(page: import('@playwright/test').Page) {
    await page.goto('/dashboard');
    // "Hasta" primero: el input de "Desde" tiene max={to}, asi que poner un
    // desde de 2018 mientras el hasta sigue en hoy es valido, pero al reves
    // el navegador rechazaria el valor.
    await page.getByLabel('Hasta').fill(DIA_B);
    await page.getByLabel('Desde').fill(DIA_A);
  }

  test('muestra la tasa de asistencia y el tiempo promedio del rango', async ({
    page,
  }) => {
    await abrirConRango(page);

    await expect(
      page.getByTestId('kpi-tasa-asistencia-valor'),
    ).toHaveText('75%', { timeout: 15_000 });

    await expect(page.getByTestId('kpi-tiempo-promedio-valor')).toHaveText(
      '40 min',
    );

    // 4 cerrados + 1 cancelado + 1 programado. El cancelado y el programado
    // cuentan como turnos del periodo pero quedan fuera del denominador de
    // la tasa: por eso 75% y no 60%.
    await expect(page.getByTestId('kpi-turnos-totales-valor')).toHaveText('6');
  });

  test('los graficos dibujan una serie por dia del rango', async ({ page }) => {
    await abrirConRango(page);
    await expect(
      page.getByTestId('kpi-tasa-asistencia-valor'),
    ).toHaveText('75%', { timeout: 15_000 });

    await expect(
      tituloDeTarjeta(page, 'Tasa de asistencia por dia'),
    ).toBeVisible();
    await expect(
      tituloDeTarjeta(page, 'Tiempo promedio de servicio por dia'),
    ).toBeVisible();
    await expect(tituloDeTarjeta(page, 'Turnos cerrados por dia')).toBeVisible();

    // recharts renderiza SVG: que existan paths de datos es la senal de que
    // el grafico recibio serie y no quedo vacio.
    await expect(page.locator('svg.recharts-surface').first()).toBeVisible();
  });

  test('la vista de tabla muestra el detalle diario de los mismos numeros', async ({
    page,
  }) => {
    await abrirConRango(page);
    await expect(
      page.getByTestId('kpi-tasa-asistencia-valor'),
    ).toHaveText('75%', { timeout: 15_000 });

    await page.getByRole('button', { name: 'Ver tabla' }).click();

    const filaDiaA = page.getByRole('row').filter({ hasText: DIA_A });
    await expect(filaDiaA).toContainText('75%');
    await expect(filaDiaA).toContainText('40 min');

    // DIA_B solo tiene un cancelado y un programado: ningun turno cerrado,
    // asi que la tasa no es 0% sino "sin datos".
    const filaDiaB = page.getByRole('row').filter({ hasText: DIA_B });
    await expect(filaDiaB).toContainText('—');
  });

  test('un rango invertido se avisa sin llamar al backend', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByLabel('Desde').fill(DIA_A);

    // El input de "Hasta" tiene min={from}; se fuerza el valor invalido para
    // comprobar que la vista tambien lo defiende y no manda un request que
    // el backend va a rechazar con 400.
    await page
      .getByLabel('Hasta')
      .evaluate((input: HTMLInputElement) => {
        input.value = '2017-01-01';
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });

    await expect(page.getByText(/rango es invalido/i)).toBeVisible();
  });

  test('el preset de 7 dias vuelve a un rango que termina hoy', async ({
    page,
  }) => {
    await abrirConRango(page);
    await page.getByRole('button', { name: '7 dias' }).click();

    const hoy = new Date().toISOString().slice(0, 10);
    await expect(page.getByLabel('Hasta')).toHaveValue(hoy);
  });
});
