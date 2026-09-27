/**
 * Cuantos proxies hay delante del servicio (Sprint 23), para Express
 * `trust proxy`.
 *
 * Detras del ALB, `req.ip` es la IP del balanceador salvo que Express
 * confie en X-Forwarded-For. El registro de aceptaciones legales guarda la
 * IP de quien acepta: sin esto, todas quedarian con la misma IP interna.
 *
 * Un NUMERO de saltos y no `true`: con `true` Express toma la primera IP
 * del encabezado, que la escribe el cliente y se puede falsificar. Con 1
 * toma la que agrego el balanceador.
 *
 * TRUST_PROXY sin setear = 0 (desarrollo, sin proxy).
 */
export function saltosDeProxy(): number {
  const valor = process.env.TRUST_PROXY?.trim();
  if (!valor) return 0;
  const saltos = Number(valor);
  if (!Number.isInteger(saltos) || saltos < 0 || saltos > 5) {
    throw new Error(
      `TRUST_PROXY debe ser un entero entre 0 y 5 (cantidad de proxies delante del servicio); llego "${valor}".`,
    );
  }
  return saltos;
}
