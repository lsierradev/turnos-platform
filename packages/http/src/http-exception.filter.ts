import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';

// Codigos de error de Postgres que NO son un 500.
//
// 57014 (query_canceled) lo dispara el statement_timeout que
// DashboardService se pone a si mismo para no retener una conexion del pool
// que comparte con el motor de reservas. Semanticamente es un servicio
// degradado, no una peticion invalida ni un bug: sale como 503 para que no
// contamine la metrica de 5xx reales, que es la que alimenta el SLA.
//
// 22P02 (invalid_text_representation) es un uuid o un numero mal formado que
// llego hasta la base. Los pipes de los controllers deberian atajarlo antes
// (ver docs/AUDITORIA-ENDPOINTS.md), pero si alguno se escapa, la respuesta
// correcta es 400: el cliente mando algo invalido, el servidor no fallo.
const ESTADO_POR_CODIGO_PG: Record<string, HttpStatus> = {
  '57014': HttpStatus.SERVICE_UNAVAILABLE,
  '22P02': HttpStatus.BAD_REQUEST,
  '23505': HttpStatus.CONFLICT, // unique_violation
  '23503': HttpStatus.CONFLICT, // foreign_key_violation
};

interface CuerpoError {
  statusCode: number;
  error: string;
  message: string | string[];
  requestId: string;
  timestamp: string;
  path: string;
}

function codigoPostgres(error: unknown): string | undefined {
  const e = error as { code?: string; driverError?: { code?: string } };
  return e?.code ?? e?.driverError?.code;
}

/**
 * Formato de error unico para toda la API.
 *
 * Hasta Sprint 9 cada error salia con el formato por defecto de Nest y sin
 * ningun identificador: durante un beta, "me dio error" del lado del CDA era
 * imposible de cruzar con una linea de log concreta. Ahora toda respuesta de
 * error lleva un `requestId` que ademas se escribe en el log del 5xx.
 *
 * Lo que este filtro NO hace es aplanar los cuerpos de error que ya son
 * estructurados. El 409 de double-booking responde
 * `{ message, sugerencias: [...] }` y esas sugerencias son parte del
 * contrato de HU2 (el frontend las ofrece como botones): se preservan tal
 * cual y solo se les agregan los campos comunes.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<{
      status: (codigo: number) => { json: (cuerpo: unknown) => void };
    }>();
    const request = ctx.getRequest<{ url?: string; method?: string }>();

    const requestId = randomUUID();
    const { status, cuerpo } = this.interpretar(exception);

    const base: CuerpoError = {
      statusCode: status,
      error: HttpStatus[status] ?? 'ERROR',
      message: cuerpo.message,
      requestId,
      timestamp: new Date().toISOString(),
      path: request?.url ?? '',
    };

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // Solo los 5xx se loguean con el stack: un 404 o un 409 son
      // respuestas esperadas del negocio, no incidentes, y llenar el log
      // con ellas esconde los errores de verdad.
      this.logger.error(
        `[${requestId}] ${request?.method ?? ''} ${request?.url ?? ''} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({ ...cuerpo.extra, ...base });
  }

  private interpretar(exception: unknown): {
    status: number;
    cuerpo: { message: string | string[]; extra: Record<string, unknown> };
  } {
    if (exception instanceof HttpException) {
      const respuesta = exception.getResponse();

      if (typeof respuesta === 'string') {
        return {
          status: exception.getStatus(),
          cuerpo: { message: respuesta, extra: {} },
        };
      }

      // Cuerpo estructurado: se conservan todas sus claves (`sugerencias`
      // del 409, el array de errores de validacion del ValidationPipe, ...)
      // y solo se descartan las que el formato comun vuelve a escribir.
      const { message, statusCode, error, ...extra } = respuesta as Record<
        string,
        unknown
      > & { message?: string | string[] };
      void statusCode;
      void error;

      return {
        status: exception.getStatus(),
        cuerpo: { message: message ?? exception.message, extra },
      };
    }

    const codigo = codigoPostgres(exception);
    if (codigo && ESTADO_POR_CODIGO_PG[codigo]) {
      const status = ESTADO_POR_CODIGO_PG[codigo];
      return {
        status,
        cuerpo: {
          message:
            status === HttpStatus.SERVICE_UNAVAILABLE
              ? 'La consulta excedio el tiempo maximo. Proba de nuevo o acota el rango.'
              : 'La peticion no pudo procesarse con los datos enviados.',
          extra: {},
        },
      };
    }

    // Cualquier otra cosa es un bug: no se filtra nada del error original al
    // cliente, solo el requestId con el que buscarlo en el log.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      cuerpo: { message: 'Error interno del servidor.', extra: {} },
    };
  }
}
