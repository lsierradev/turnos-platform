import type { AceptacionLegal, DocumentoPlataforma, TipoDocumento } from '@/lib/api-client';

/** Nombre corto de cada documento, para listas y casillas. */
export const NOMBRE_DOCUMENTO: Record<TipoDocumento, string> = {
  terminos_taller: 'Términos y Condiciones de TurnoPro',
  politica_datos: 'Política de Tratamiento de Datos Personales',
  autorizacion_datos: 'Autorización para el tratamiento de datos',
  condiciones_taller: 'Condiciones del servicio del taller',
};

/** Lo que dice la casilla de cada documento al aceptarlo. */
export const TEXTO_ACEPTAR: Record<TipoDocumento, string> = {
  terminos_taller: 'Acepto los Términos y Condiciones en nombre del taller y declaro que tengo facultades para hacerlo.',
  politica_datos: 'Leí la Política de Tratamiento de Datos Personales.',
  autorizacion_datos:
    'Autorizo de manera previa, expresa e informada el tratamiento de mis datos personales.',
  condiciones_taller: 'Leí y acepto las condiciones del servicio del taller.',
};

export const CANAL: Record<AceptacionLegal['canal'], string> = {
  web: 'Web',
  app: 'App',
  presencial: 'En el mostrador',
};

/** Los que se pueden abrir en /legal/:documento (publicos). */
export const DOCUMENTOS_PUBLICOS: DocumentoPlataforma[] = [
  'terminos_taller',
  'politica_datos',
  'autorizacion_datos',
];

export function esDocumentoPublico(valor: string | undefined): valor is DocumentoPlataforma {
  return DOCUMENTOS_PUBLICOS.includes(valor as DocumentoPlataforma);
}

/** Cache de react-query de lo que falta aceptar (lo invalida quien acepta). */
export const CLAVE_PENDIENTES = ['legal', 'pendientes'] as const;
