import { APIRequestContext, APIResponse, expect, test } from '@playwright/test';
import {
  DatosSembrados,
  horarioLaboral,
  limpiar,
  sembrar,
} from '../fixtures/datos-de-prueba';
import { encabezados, iniciarSesion } from '../fixtures/sesion';
import { URL_RESERVAS } from '../playwright.config';

/**
 * HU2 - Como cliente quiero que el sistema me impida reservar un horario ya
 * ocupado y me ofrezca alternativas cercanas, para no perder el turno.
 *
 * Es la HU que sostiene el criterio de aceptacion "cero reservas duplicadas"
 * (seccion 14 del SRS), asi que el test no se conforma con dos reservas
 * secuenciales: dispara varias en paralelo, que es el escenario donde una
 * validacion hecha en la capa de aplicacion (leer y despues escribir) se
 * rompe y la constraint EXCLUDE de la base no.
 */
test.describe('HU2 - Conflicto de horario y sugerencias', () => {
  let datos: DatosSembrados;
  let token: string;

  test.beforeAll(async ({ request }) => {
    datos = await sembrar();
    token = await iniciarSesion(request, datos.clienteEmail);
  });

  test.afterAll(async () => {
    await limpiar(datos);
  });

  function reservar(
    request: APIRequestContext,
    inicio: Date,
    bahiaId: string = datos.bahiaId,
  ): Promise<APIResponse> {
    return request.post(`${URL_RESERVAS}/appointments`, {
      headers: encabezados(token),
      data: {
        bahiaId,
        servicioId: datos.servicioId,
        tecnicoId: datos.tecnicoId,
        inicio: inicio.toISOString(),
      },
    });
  }

  test('el segundo intento sobre el mismo horario recibe 409 con 3 sugerencias', async ({
    request,
  }) => {
    const inicio = horarioLaboral(9, 3);

    const primera = await reservar(request, inicio);
    expect(primera.status(), await primera.text()).toBe(201);

    const segunda = await reservar(request, inicio);
    expect(segunda.status()).toBe(409);

    const cuerpo = await segunda.json();
    expect(cuerpo.message).toMatch(/bahia/i);
    expect(Array.isArray(cuerpo.sugerencias)).toBe(true);
    expect(cuerpo.sugerencias).toHaveLength(3);

    for (const sugerencia of cuerpo.sugerencias) {
      const desde = new Date(sugerencia.inicio);
      const hasta = new Date(sugerencia.fin);

      // Una sugerencia tiene que ser reservable de verdad: dentro del
      // horario laboral, con la duracion del servicio y sin pisar el turno
      // que acaba de ocupar el lugar. Devolver horarios que vuelven a dar
      // 409 seria peor que no sugerir nada.
      expect(desde.getUTCHours()).toBeGreaterThanOrEqual(8);
      expect(hasta.getUTCHours()).toBeLessThanOrEqual(18);
      expect((hasta.getTime() - desde.getTime()) / 60_000).toBe(
        datos.duracionMinutos,
      );
      const seSolapa =
        desde < new Date(inicio.getTime() + datos.duracionMinutos * 60_000) &&
        inicio < hasta;
      expect(seSolapa).toBe(false);
    }
  });

  test('la primera sugerencia devuelta se puede reservar sin conflicto', async ({
    request,
  }) => {
    const inicio = horarioLaboral(10, 4);

    expect((await reservar(request, inicio)).status()).toBe(201);

    const conflicto = await reservar(request, inicio);
    expect(conflicto.status()).toBe(409);
    const { sugerencias } = await conflicto.json();

    // El cierre real del circuito de la HU: el cliente toma la alternativa
    // que le ofrecio el sistema y esa reserva entra.
    const reintento = await reservar(request, new Date(sugerencias[0].inicio));
    expect(reintento.status(), await reintento.text()).toBe(201);
  });

  test('el mismo tecnico no puede quedar en dos turnos solapados aunque cambie la bahia', async ({
    request,
  }) => {
    const inicio = horarioLaboral(14, 5);

    expect((await reservar(request, inicio)).status()).toBe(201);

    // Otra bahia, mismo tecnico y mismo horario: lo bloquea la segunda
    // constraint EXCLUDE (turnos_tecnico_rango_excl).
    const segunda = await reservar(request, inicio, datos.otraBahiaId);
    expect(segunda.status()).toBe(409);
    expect((await segunda.json()).message).toMatch(/tecnico/i);
  });

  test('cero reservas duplicadas: de 5 intentos simultaneos entra exactamente 1', async ({
    request,
  }) => {
    const inicio = horarioLaboral(16, 6);

    const respuestas = await Promise.all(
      Array.from({ length: 5 }, () => reservar(request, inicio)),
    );
    const estados = respuestas.map((r) => r.status());

    expect(estados.filter((e) => e === 201)).toHaveLength(1);
    expect(estados.filter((e) => e === 409)).toHaveLength(4);
    // Ningun 500: el conflicto tiene que salir como 409 manejado, no como
    // una excepcion de Postgres que se escapo sin traducir.
    expect(estados.filter((e) => e >= 500)).toHaveLength(0);
  });
});
