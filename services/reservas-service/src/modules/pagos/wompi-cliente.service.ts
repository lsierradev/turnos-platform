import { Injectable, Logger } from '@nestjs/common';
import { decrypt } from '@turnos-platform/crypto';
import { ContextoDb } from '@turnos-platform/tenant';
import { AmbienteWompi, TransaccionWompi, urlApiWompi } from './wompi.util';

export interface CredencialesTaller {
  ambiente: AmbienteWompi;
  llavePublica: string;
  llavePrivada: string;
  secretoIntegridad: string;
  secretoEventos: string;
}

const TIMEOUT_MS = 10_000;

/**
 * Llamadas a la API de Wompi con las llaves del taller (Sprint 24). Las
 * credenciales se leen en modo sistema con el taller explicito: el cliente
 * que paga no puede leer credenciales_taller (RLS), y el webhook no tiene
 * sesion.
 *
 * Es un provider aparte para que las pruebas lo reemplacen: nada de lo que
 * pasa por aca sale a internet en CI.
 */
@Injectable()
export class WompiCliente {
  private readonly logger = new Logger(WompiCliente.name);

  constructor(private readonly db: ContextoDb) {}

  async credenciales(tallerId: string): Promise<CredencialesTaller | null> {
    const [fila] = (await this.db.sistema((m) =>
      m.query(
        `SELECT wompi_ambiente AS ambiente, wompi_llave_publica AS "llavePublica",
                wompi_llave_privada_cifrada AS "llavePrivada",
                wompi_secreto_integridad_cifrado AS "secretoIntegridad",
                wompi_secreto_eventos_cifrado AS "secretoEventos"
           FROM credenciales_taller WHERE taller_id = $1`,
        [tallerId],
      ),
    )) as (Record<keyof CredencialesTaller, string | null> | undefined)[];
    if (
      !fila?.ambiente ||
      !fila.llavePublica ||
      !fila.llavePrivada ||
      !fila.secretoIntegridad ||
      !fila.secretoEventos
    ) {
      return null;
    }
    return {
      ambiente: fila.ambiente as AmbienteWompi,
      llavePublica: fila.llavePublica,
      llavePrivada: decrypt(fila.llavePrivada),
      secretoIntegridad: decrypt(fila.secretoIntegridad),
      secretoEventos: decrypt(fila.secretoEventos),
    };
  }

  /** Las transacciones de una referencia (conciliacion). */
  async transaccionesPorReferencia(
    c: CredencialesTaller,
    referencia: string,
  ): Promise<TransaccionWompi[]> {
    const r = await this.llamar(
      c,
      'GET',
      `/transactions?reference=${encodeURIComponent(referencia)}`,
    );
    if (!r.ok) {
      throw new Error(`Wompi respondio ${r.status} al consultar ${referencia}`);
    }
    const cuerpo = (await r.json()) as { data?: TransaccionWompi[] };
    return Array.isArray(cuerpo.data) ? cuerpo.data : [];
  }

  async transaccion(
    c: CredencialesTaller,
    id: string,
  ): Promise<TransaccionWompi | null> {
    const r = await this.llamar(
      c,
      'GET',
      `/transactions/${encodeURIComponent(id)}`,
    );
    if (r.status === 404) return null;
    if (!r.ok)
      throw new Error(`Wompi respondio ${r.status} al consultar ${id}`);
    return ((await r.json()) as { data: TransaccionWompi }).data;
  }

  /**
   * Anula una transaccion con tarjeta (POST /transactions/:id/void). Es el
   * unico medio con devolucion por API; el resultado final llega como
   * evento VOIDED. Devuelve el motivo si Wompi no la acepto.
   */
  async anular(
    c: CredencialesTaller,
    id: string,
  ): Promise<{ ok: true } | { ok: false; motivo: string }> {
    try {
      const r = await this.llamar(
        c,
        'POST',
        `/transactions/${encodeURIComponent(id)}/void`,
      );
      if (r.ok) return { ok: true };
      const texto = await r.text().catch(() => '');
      return {
        ok: false,
        motivo: `Wompi respondio ${r.status}: ${texto.slice(0, 300)}`,
      };
    } catch (error) {
      return { ok: false, motivo: (error as Error).message };
    }
  }

  private async llamar(
    c: CredencialesTaller,
    metodo: 'GET' | 'POST',
    ruta: string,
  ): Promise<Response> {
    try {
      return await fetch(`${urlApiWompi(c.ambiente)}${ruta}`, {
        method: metodo,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${c.llavePrivada}`,
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(
        `Wompi no respondio (${ruta}): ${(error as Error).message}`,
      );
      throw error;
    }
  }
}
