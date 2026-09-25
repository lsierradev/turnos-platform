import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';

export type AmbienteWompi = 'pruebas' | 'produccion';

export interface CredencialesWompi {
  ambiente: AmbienteWompi;
  llavePublica: string;
  llavePrivada: string;
  secretoIntegridad: string;
  secretoEventos: string;
}

/**
 * Prefijos de las llaves de Wompi por ambiente. Una llave de pruebas
 * guardada como produccion cobraria "de mentira" en el taller real (o al
 * reves): se rechaza antes de llamar a nadie.
 */
const PREFIJOS_WOMPI: Record<
  AmbienteWompi,
  Record<keyof Omit<CredencialesWompi, 'ambiente'>, string>
> = {
  pruebas: {
    llavePublica: 'pub_test_',
    llavePrivada: 'prv_test_',
    secretoIntegridad: 'test_integrity_',
    secretoEventos: 'test_events_',
  },
  produccion: {
    llavePublica: 'pub_prod_',
    llavePrivada: 'prv_prod_',
    secretoIntegridad: 'prod_integrity_',
    secretoEventos: 'prod_events_',
  },
};

const NOMBRES_WOMPI = {
  llavePublica: 'llave publica',
  llavePrivada: 'llave privada',
  secretoIntegridad: 'secreto de integridad',
  secretoEventos: 'secreto de eventos',
};

const TIMEOUT_MS = 8_000;

/**
 * Valida las credenciales del taller contra el proveedor ANTES de
 * guardarlas (Sprint 21): un token mal copiado se descubre al guardarlo,
 * no el dia que un cliente intenta pagar o que hay que facturar.
 *
 * `VALIDACION_PROVEEDORES=omitir` saltea las llamadas (desarrollo y tests
 * sin internet). En produccion no se puede omitir.
 */
@Injectable()
export class ValidadorProveedores {
  private readonly logger = new Logger(ValidadorProveedores.name);

  /** true si se valido de verdad; false si se omitio (solo fuera de produccion). */
  omitir(): boolean {
    return (
      process.env.VALIDACION_PROVEEDORES === 'omitir' &&
      process.env.NODE_ENV !== 'production'
    );
  }

  async validarAlegra(usuario: string, token: string): Promise<boolean> {
    if (this.omitir()) return false;
    const base = process.env.ALEGRA_API_URL ?? 'https://api.alegra.com/api/v1';
    const basic = Buffer.from(`${usuario}:${token}`).toString('base64');
    const respuesta = await this.llamar('Alegra', `${base}/company`, {
      Authorization: `Basic ${basic}`,
    });
    if (respuesta.status === 401 || respuesta.status === 403) {
      throw new BadRequestException(
        'Alegra rechazo el usuario o el token. Revisa que el correo sea el de la cuenta de Alegra y copia el token de nuevo.',
      );
    }
    this.exigirOk('Alegra', respuesta);
    return true;
  }

  /** Solo formato: se usa tambien al actualizar sin reenviar los secretos. */
  validarFormatoWompi(
    credenciales: Partial<CredencialesWompi> & { ambiente: AmbienteWompi },
  ): void {
    const prefijos = PREFIJOS_WOMPI[credenciales.ambiente];
    for (const campo of Object.keys(prefijos) as (keyof typeof prefijos)[]) {
      const valor = credenciales[campo];
      if (valor !== undefined && !valor.startsWith(prefijos[campo])) {
        throw new BadRequestException(
          `La ${NOMBRES_WOMPI[campo]} de Wompi no corresponde al ambiente de ${credenciales.ambiente} (debe empezar con "${prefijos[campo]}").`,
        );
      }
    }
  }

  /**
   * Llave publica: el comercio existe. Llave privada: autentica contra la
   * API. Los dos secretos no tienen endpoint para validarlos; se revisa su
   * formato y se prueban en el primer cobro (Sprint 24).
   */
  async validarWompi(credenciales: CredencialesWompi): Promise<boolean> {
    this.validarFormatoWompi(credenciales);
    if (this.omitir()) return false;
    const base =
      credenciales.ambiente === 'produccion'
        ? (process.env.WOMPI_API_URL_PRODUCCION ??
          'https://production.wompi.co/v1')
        : (process.env.WOMPI_API_URL_PRUEBAS ?? 'https://sandbox.wompi.co/v1');

    const comercio = await this.llamar(
      'Wompi',
      `${base}/merchants/${encodeURIComponent(credenciales.llavePublica)}`,
      {},
    );
    if (
      comercio.status === 404 ||
      comercio.status === 401 ||
      comercio.status === 422
    ) {
      throw new BadRequestException('Wompi no reconoce la llave publica.');
    }
    this.exigirOk('Wompi', comercio);

    const privada = await this.llamar(
      'Wompi',
      `${base}/transactions?reference=turnopro-validacion`,
      { Authorization: `Bearer ${credenciales.llavePrivada}` },
    );
    if (privada.status === 401 || privada.status === 403) {
      throw new BadRequestException('Wompi rechazo la llave privada.');
    }
    this.exigirOk('Wompi', privada);
    return true;
  }

  private async llamar(
    proveedor: string,
    url: string,
    headers: Record<string, string>,
  ): Promise<Response> {
    try {
      return await fetch(url, {
        headers: { Accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(
        `${proveedor} no respondio: ${(error as Error).message}`,
      );
      throw new BadGatewayException(
        `No se pudo validar con ${proveedor} en este momento. Intenta de nuevo en unos minutos.`,
      );
    }
  }

  private exigirOk(proveedor: string, respuesta: Response): void {
    if (!respuesta.ok) {
      this.logger.warn(
        `${proveedor} respondio ${respuesta.status} al validar credenciales`,
      );
      throw new BadGatewayException(
        `${proveedor} respondio con un error (${respuesta.status}). Intenta de nuevo en unos minutos.`,
      );
    }
  }
}
