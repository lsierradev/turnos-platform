import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

/*
 * Documentos legales de TurnoPro, versionados (Sprint 23).
 *
 * Cada version es un archivo en ./textos que NO se edita una vez que
 * alguien la acepto en produccion: un cambio es una version nueva (un
 * archivo nuevo y una entrada nueva aca). La aceptacion guarda la version y
 * el SHA-256 del texto; si el archivo cambiara por debajo, la prueba de lo
 * que el usuario acepto dejaria de coincidir. catalogo.spec.ts falla si el
 * hash de un archivo no es el anotado aca: editar un texto obliga a tocar
 * este archivo a conciencia.
 *
 * Las condiciones de cada taller con sus clientes NO estan aca: son texto
 * del taller, en la tabla condiciones_taller (migracion 018). Aca esta la
 * plantilla de la que parten.
 */

export type DocumentoPlataforma =
  'terminos_taller' | 'politica_datos' | 'autorizacion_datos';

export type TipoDocumento = DocumentoPlataforma | 'condiciones_taller';

export const DOCUMENTOS_PLATAFORMA: DocumentoPlataforma[] = [
  'terminos_taller',
  'politica_datos',
  'autorizacion_datos',
];

export const TIPOS_DOCUMENTO: TipoDocumento[] = [
  ...DOCUMENTOS_PLATAFORMA,
  'condiciones_taller',
];

export interface VersionDocumento {
  version: number;
  archivo: string;
  sha256: string;
  /** Fecha desde la que rige (YYYY-MM-DD). */
  vigenteDesde: string;
  /**
   * Pendiente de revision de abogado. En produccion el servicio lo avisa
   * al arrancar (ver LegalService.onModuleInit): no se sale con borradores.
   */
  borrador: boolean;
}

interface EntradaCatalogo {
  titulo: string;
  /** De la mas vieja a la vigente (la ultima). */
  versiones: VersionDocumento[];
}

export const CATALOGO: Record<DocumentoPlataforma, EntradaCatalogo> = {
  terminos_taller: {
    titulo: 'Términos y Condiciones para talleres',
    versiones: [
      {
        version: 1,
        archivo: 'terminos-taller-v1.md',
        sha256:
          '5e6bcd9f37fe5d1505e23049f4dc85c4484a92cd587ae9fa7b70c945b1cd9612',
        vigenteDesde: '2026-09-26',
        borrador: true,
      },
    ],
  },
  politica_datos: {
    titulo: 'Política de Tratamiento de Datos Personales',
    versiones: [
      {
        version: 1,
        archivo: 'politica-datos-v1.md',
        sha256:
          'e618f18e41ee89db974bd6d44242a8f87cc0011f9aebb853ab7866caa945110a',
        vigenteDesde: '2026-09-26',
        borrador: true,
      },
    ],
  },
  autorizacion_datos: {
    titulo: 'Autorización para el tratamiento de datos personales',
    versiones: [
      {
        version: 1,
        archivo: 'autorizacion-datos-v1.md',
        sha256:
          'c9ddeb1a13a2605a54f9d3df07b794f929dc41438a4147810abdd0173b251531',
        vigenteDesde: '2026-09-26',
        borrador: true,
      },
    ],
  },
};

/** Plantilla de condiciones taller-cliente (la personaliza cada taller). */
export const PLANTILLA_CONDICIONES: VersionDocumento = {
  version: 1,
  archivo: 'condiciones-cliente-plantilla-v1.md',
  sha256: '8fc50d98f8a49ea10f31e857646b40dd4b3aa74485d83c2c46b8995b002794b0',
  vigenteDesde: '2026-09-26',
  borrador: true,
};

export const TITULO_CONDICIONES = 'Condiciones del servicio del taller';

export const sha256 = (texto: string): string =>
  createHash('sha256').update(texto, 'utf8').digest('hex');

const DIRECTORIO_TEXTOS = join(__dirname, 'textos');
const cache = new Map<string, string>();

/**
 * El texto de un archivo de ./textos. nest-cli.json los copia a dist
 * (assets): sin eso el servicio compilado no los encuentra.
 */
export function leerTexto(archivo: string): string {
  let texto = cache.get(archivo);
  if (texto === undefined) {
    // Fin de linea normalizado: un checkout en Windows con autocrlf no
    // puede cambiar el hash de un texto que ya se acepto.
    texto = readFileSync(join(DIRECTORIO_TEXTOS, archivo), 'utf8').replace(
      /\r\n/g,
      '\n',
    );
    cache.set(archivo, texto);
  }
  return texto;
}

export function versionVigente(tipo: DocumentoPlataforma): VersionDocumento {
  const { versiones } = CATALOGO[tipo];
  return versiones[versiones.length - 1];
}

export function buscarVersion(
  tipo: DocumentoPlataforma,
  version: number,
): VersionDocumento | undefined {
  return CATALOGO[tipo].versiones.find((v) => v.version === version);
}

/** Que documentos de la plataforma acepta cada rol (el superadmin, ninguno). */
export function documentosDelRol(rol: string): DocumentoPlataforma[] {
  if (rol === 'admin')
    return ['terminos_taller', 'politica_datos', 'autorizacion_datos'];
  if (rol === 'tecnico' || rol === 'cliente')
    return ['politica_datos', 'autorizacion_datos'];
  return [];
}

/**
 * Marcas que un texto publicable no puede tener: ⟦COMPLETAR: …⟧ (falta un
 * dato) y ⟦REVISIÓN LEGAL: …⟧ (nota para el abogado). Tambien un
 * {{marcador}} de la plantilla que no se reemplazo.
 */
export function marcasPendientes(texto: string): string[] {
  return [
    ...(texto.match(/⟦[^⟧]*⟧/g) ?? []),
    ...(texto.match(/\{\{[^}]*\}\}/g) ?? []),
  ];
}
