import { ApiError, STATUS_SIN_CONEXION } from './api-client';

export interface ErrorDescrito {
  /** Que paso, en una linea y en terminos del usuario. */
  titulo: string;
  /** Que puede hacer al respecto. */
  descripcion: string;
  /** Mensaje tecnico del backend, si aporta algo (se muestra chico). */
  detalle?: string;
  /**
   * Si tiene sentido ofrecer "Reintentar". Un 400/403/404 va a dar lo mismo
   * la proxima vez: ofrecerlo solo invita a insistir.
   */
  reintentable: boolean;
}

/**
 * Traduce cualquier error de una query a un mensaje distinto por tipo
 * (hallazgo 3 de UX-NOTES.md). Antes se mostraba el `message` del backend
 * tal cual: un "Validation failed (uuid is expected)" o un
 * "Internal server error" no le dicen al usuario ni que paso ni que hacer.
 */
export function describirError(error: unknown): ErrorDescrito {
  if (!(error instanceof ApiError)) {
    return {
      titulo: 'Algo salio mal',
      descripcion: 'Ocurrio un error inesperado en el panel.',
      detalle: error instanceof Error ? error.message : undefined,
      reintentable: true,
    };
  }

  const detalle = error.message || undefined;

  switch (true) {
    case error.status === STATUS_SIN_CONEXION:
      return {
        titulo: 'Sin conexion con el servidor',
        descripcion:
          'Revisa la conexion del equipo. Si el resto funciona, el servicio puede estar caido.',
        reintentable: true,
      };
    case error.status === 400:
      return {
        titulo: 'La solicitud no es valida',
        descripcion: 'Algun dato enviado no tiene el formato esperado.',
        detalle,
        reintentable: false,
      };
    case error.status === 401:
      return {
        titulo: 'Tu sesion expiro',
        descripcion: 'Volve a iniciar sesion para continuar.',
        reintentable: false,
      };
    case error.status === 403:
      return {
        titulo: 'Sin permiso',
        descripcion: 'Tu usuario no tiene permiso para ver esto.',
        reintentable: false,
      };
    case error.status === 404:
      return {
        titulo: 'No encontrado',
        descripcion: 'Lo que buscas no existe o fue eliminado.',
        detalle,
        reintentable: false,
      };
    case error.status === 409:
      return {
        titulo: 'Conflicto con otro registro',
        descripcion: 'Alguien modifico este dato al mismo tiempo.',
        detalle,
        reintentable: true,
      };
    case error.status >= 500:
      return {
        titulo: 'El servidor tuvo un problema',
        descripcion:
          'No es algo que hayas hecho vos. Reintenta en unos segundos; si sigue, avisale a soporte.',
        detalle: `Error ${error.status}`,
        reintentable: true,
      };
    default:
      return {
        titulo: `Error ${error.status}`,
        descripcion: 'La solicitud no se pudo completar.',
        detalle,
        reintentable: true,
      };
  }
}

/** Para la politica de reintentos de TanStack Query. */
export function esReintentable(error: unknown): boolean {
  return describirError(error).reintentable;
}
