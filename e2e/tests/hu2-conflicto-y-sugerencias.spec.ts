import { APIRequestContext, APIResponse, expect, test } from '@playwright/test';
import {
  DatosSembrados,
  fechaISO,
  horaEnTaller,
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
  // Un token por cliente sembrado. Hace falta porque desde la migracion 010
  // un mismo usuario tampoco puede solaparse consigo mismo: si los dos
  // intentos sobre el mismo horario vinieran del mismo cliente, se violarian
  // DOS constraints a la vez y el mensaje del 409 dependeria de cual evalue
  // Postgres primero. Dos clientes distintos peleando por el mismo horario
  // es ademas lo que pasa en la realidad.
  let tokens: string[];

  test.beforeAll(async ({ request }) => {
    datos = await sembrar();
    tokens = await Promise.all(
      datos.clientes.map((cliente) => iniciarSesion(request, cliente.email)),
    );
  });

  test.afterAll(async () => {
    await limpiar(datos);
  });

  function reservar(
    request: APIRequestContext,
    inicio: Date,
    opciones: {
      bahiaId?: string;
      cliente?: number;
      tecnicoId?: string;
    } = {},
  ): Promise<APIResponse> {
    const {
      bahiaId = datos.bahiaId,
      cliente = 0,
      tecnicoId = datos.tecnicoId,
    } = opciones;
    return request.post(`${URL_RESERVAS}/appointments`, {
      headers: encabezados(tokens[cliente]),
      data: {
        bahiaId,
        servicioId: datos.servicioId,
        tecnicoId,
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

    const segunda = await reservar(request, inicio, { cliente: 1 });
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
      // Hora del taller, no UTC: 08:00 en Bogota son las 13:00Z.
      expect(horaEnTaller(desde) >= '08:00').toBe(true);
      expect(horaEnTaller(hasta) <= '18:00').toBe(true);
      expect(fechaISO(hasta)).toBe(fechaISO(desde));
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

    const conflicto = await reservar(request, inicio, { cliente: 1 });
    expect(conflicto.status()).toBe(409);
    const { sugerencias } = await conflicto.json();

    // El cierre real del circuito de la HU: el cliente toma la alternativa
    // que le ofrecio el sistema y esa reserva entra.
    const reintento = await reservar(request, new Date(sugerencias[0].inicio), { cliente: 1 });
    expect(reintento.status(), await reintento.text()).toBe(201);
  });

  test('el mismo tecnico no puede quedar en dos turnos solapados aunque cambie la bahia', async ({
    request,
  }) => {
    const inicio = horarioLaboral(14, 5);

    expect((await reservar(request, inicio)).status()).toBe(201);

    // Otra bahia, mismo tecnico y mismo horario: lo bloquea la segunda
    // constraint EXCLUDE (turnos_tecnico_rango_excl).
    const segunda = await reservar(request, inicio, { bahiaId: datos.otraBahiaId, cliente: 1 });
    expect(segunda.status()).toBe(409);
    expect((await segunda.json()).message).toMatch(/tecnico/i);
  });

  test('un cliente tampoco puede solaparse consigo mismo en otra bahia', async ({
    request,
  }) => {
    const inicio = horarioLaboral(11, 7);

    expect((await reservar(request, inicio)).status()).toBe(201);

    // Mismo cliente, pero OTRA bahia y OTRO tecnico: para el taller los dos
    // recursos estan libres, asi que ninguna de las constraints de 001/006
    // aplica. Lo que bloquea es la de 010: el cliente no puede estar en dos
    // lugares a la vez.
    const segunda = await reservar(request, inicio, {
      bahiaId: datos.otraBahiaId,
      tecnicoId: datos.otroTecnicoId,
    });
    expect(segunda.status()).toBe(409);
    expect((await segunda.json()).message).toMatch(/ya tenes otro turno/i);
  });

  test('cero reservas duplicadas: de 5 intentos simultaneos entra exactamente 1', async ({
    request,
  }) => {
    const inicio = horarioLaboral(16, 6);

    // Cinco CLIENTES distintos sobre el mismo horario: el conflicto que se
    // prueba es el de la bahia, no el del propio usuario consigo mismo.
    const respuestas = await Promise.all(
      datos.clientes.map((_, cliente) =>
        reservar(request, inicio, { cliente }),
      ),
    );
    const estados = respuestas.map((r) => r.status());

    expect(estados.filter((e) => e === 201)).toHaveLength(1);
    expect(estados.filter((e) => e === 409)).toHaveLength(4);
    // Ningun 500: el conflicto tiene que salir como 409 manejado, no como
    // una excepcion de Postgres que se escapo sin traducir.
    expect(estados.filter((e) => e >= 500)).toHaveLength(0);
  });
});
