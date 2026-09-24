import { expect, test } from '@playwright/test';
import {
  DatosSembrados,
  fechaISO,
  horarioLaboral,
  limpiar,
  sembrar,
} from '../fixtures/datos-de-prueba';
import { encabezados, iniciarSesion } from '../fixtures/sesion';
import { URL_RESERVAS } from '../playwright.config';

/**
 * HU1 - Como cliente quiero reservar un turno para un servicio, con una
 * bahia y un tecnico, para asegurarme un horario de atencion.
 *
 * Se prueba a nivel API: cubre reglas (404, 400, 401, 403) que la pantalla
 * no deja ni intentar. El recorrido por navegador, desde Sprint 17, esta en
 * reserva-flujo.spec.ts. Este igual es end-to-end
 * real: login contra usuarios-service, reserva contra reservas-service y
 * lectura de vuelta por la agenda, sobre la misma Postgres, sin mocks.
 */
test.describe('HU1 - Reservar un turno', () => {
  let datos: DatosSembrados;
  let token: string;
  // Desde Sprint 9 la agenda de un tecnico solo la puede leer un admin o ese
  // mismo tecnico: el token de cliente sirve para reservar, no para
  // verificar la reserva desde la agenda.
  let tokenAdmin: string;

  test.beforeAll(async ({ request }) => {
    datos = await sembrar();
    token = await iniciarSesion(request, datos.clienteEmail);
    tokenAdmin = await iniciarSesion(request, datos.adminEmail);
  });

  test.afterAll(async () => {
    await limpiar(datos);
  });

  test('reserva un turno y lo deja visible en la agenda del tecnico', async ({
    request,
  }) => {
    const inicio = horarioLaboral(9);

    const respuesta = await request.post(`${URL_RESERVAS}/appointments`, {
      headers: encabezados(token),
      data: {
        bahiaId: datos.bahiaId,
        servicioId: datos.servicioId,
        tecnicoId: datos.tecnicoId,
        inicio: inicio.toISOString(),
      },
    });

    expect(respuesta.status(), await respuesta.text()).toBe(201);
    const turno = await respuesta.json();

    expect(turno.id).toBeTruthy();
    expect(turno.bahiaId).toBe(datos.bahiaId);
    expect(turno.tecnicoId).toBe(datos.tecnicoId);
    // El cliente no manda usuarioId: sale del `sub` del JWT. Que coincida
    // con el usuario que hizo login es la garantia de que el turno queda a
    // nombre de quien lo reservo y no de quien lo pidio en el body.
    expect(turno.usuarioId).toBe(datos.clienteId);

    // `fin` no viaja en el request: lo calcula el servidor con la duracion
    // del servicio. Si el cliente pudiera fijarlo, podria reservar 5 minutos
    // y ocupar la bahia media hora (o al reves).
    expect(new Date(turno.rangoTiempo.inicio).toISOString()).toBe(
      inicio.toISOString(),
    );
    const minutos =
      (new Date(turno.rangoTiempo.fin).getTime() -
        new Date(turno.rangoTiempo.inicio).getTime()) /
      60_000;
    expect(minutos).toBe(datos.duracionMinutos);

    // La reserva se persistio de verdad: se lee de vuelta por otro endpoint.
    const agenda = await request.get(
      `${URL_RESERVAS}/technicians/${datos.tecnicoId}/agenda?date=${fechaISO(
        inicio,
      )}`,
      { headers: encabezados(tokenAdmin) },
    );
    expect(agenda.status()).toBe(200);
    const turnos = await agenda.json();
    expect(turnos.map((t: { id: string }) => t.id)).toContain(turno.id);
  });

  test('rechaza la reserva si la bahia, el servicio o el tecnico no existen', async ({
    request,
  }) => {
    const inexistente = '00000000-0000-4000-8000-0000000000ff';

    const respuesta = await request.post(`${URL_RESERVAS}/appointments`, {
      headers: encabezados(token),
      data: {
        bahiaId: inexistente,
        servicioId: datos.servicioId,
        tecnicoId: datos.tecnicoId,
        inicio: horarioLaboral(11).toISOString(),
      },
    });

    expect(respuesta.status()).toBe(404);
  });

  test('rechaza como tecnico a un usuario que no tiene ese rol', async ({
    request,
  }) => {
    // El cliente sembrado existe como usuario, pero su rol es 'cliente'.
    // Sin esta comprobacion se le podrian asignar turnos a cualquiera.
    const respuesta = await request.post(`${URL_RESERVAS}/appointments`, {
      headers: encabezados(token),
      data: {
        bahiaId: datos.bahiaId,
        servicioId: datos.servicioId,
        tecnicoId: datos.clienteId,
        inicio: horarioLaboral(12).toISOString(),
      },
    });

    expect(respuesta.status()).toBe(404);
  });

  test('rechaza un body invalido con 400, sin llegar a la base', async ({
    request,
  }) => {
    const respuesta = await request.post(`${URL_RESERVAS}/appointments`, {
      headers: encabezados(token),
      data: {
        bahiaId: 'no-es-un-uuid',
        servicioId: datos.servicioId,
        tecnicoId: datos.tecnicoId,
        inicio: 'mañana a la tarde',
      },
    });

    expect(respuesta.status()).toBe(400);
  });

  test('un cliente no puede leer la agenda de un tecnico', async ({
    request,
  }) => {
    // La agenda expone la carga de trabajo del taller entero. Hasta Sprint 9
    // cualquier autenticado podia leerla pasando un id en la URL.
    const respuesta = await request.get(
      `${URL_RESERVAS}/technicians/${datos.tecnicoId}/agenda`,
      { headers: encabezados(token) },
    );

    expect(respuesta.status()).toBe(403);
  });

  test('exige autenticacion', async ({ request }) => {
    const respuesta = await request.post(`${URL_RESERVAS}/appointments`, {
      data: {
        bahiaId: datos.bahiaId,
        servicioId: datos.servicioId,
        tecnicoId: datos.tecnicoId,
        inicio: horarioLaboral(13).toISOString(),
      },
    });

    expect(respuesta.status()).toBe(401);
  });
});
