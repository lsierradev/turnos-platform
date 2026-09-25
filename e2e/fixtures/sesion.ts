import { APIRequestContext, expect } from '@playwright/test';
import { URL_USUARIOS } from '../playwright.config';
import { PASSWORD_DE_PRUEBA } from './datos-de-prueba';

/**
 * Login real contra usuarios-service (:3002). No se firma el token a mano:
 * que la reserva funcione con un token emitido por el emisor real es parte
 * de lo que la HU promete, y es tambien la unica verificacion end-to-end de
 * que ambos servicios comparten el mismo JWT_SECRET (si se desalinean, el
 * guard de reservas-service rechaza el token y esto falla).
 */
export async function iniciarSesion(
  request: APIRequestContext,
  email: string,
  password: string = PASSWORD_DE_PRUEBA,
): Promise<string> {
  const respuesta = await request.post(`${URL_USUARIOS}/auth/login`, {
    data: { email, password },
  });

  expect(
    respuesta.status(),
    `login fallido para ${email}: ${await respuesta.text()}`,
  ).toBe(200);

  const { accessToken } = await respuesta.json();
  expect(accessToken, 'el login no devolvio accessToken').toBeTruthy();
  return accessToken;
}

/**
 * @param tallerId el taller del request (Sprint 20). El cliente lo necesita
 *   para reservar; al personal el backend se lo ignora (usa el de su token).
 */
export function encabezados(token: string, tallerId?: string): Record<string, string> {
  return tallerId
    ? { Authorization: `Bearer ${token}`, 'X-Taller': tallerId }
    : { Authorization: `Bearer ${token}` };
}
