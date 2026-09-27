import type { Request } from 'express';
import type { Origen } from './legal.service';

/**
 * IP y navegador de quien acepta. `req.ip` respeta TRUST_PROXY (main.ts):
 * detras del balanceador, sin esa variable, todas las aceptaciones
 * quedarian con la IP del balanceador.
 */
export function origenDe(req: Request): Origen {
  const ua = req.headers['user-agent'];
  return {
    ip: req.ip ?? null,
    userAgent: typeof ua === 'string' ? ua : null,
  };
}
