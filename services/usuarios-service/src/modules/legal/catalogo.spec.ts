import {
  CATALOGO,
  DOCUMENTOS_PLATAFORMA,
  documentosDelRol,
  leerTexto,
  marcasPendientes,
  PLANTILLA_CONDICIONES,
  sha256,
  versionVigente,
} from './catalogo';
import { llenarPlantilla } from './plantilla';

describe('catalogo de documentos legales', () => {
  const todas = [
    ...DOCUMENTOS_PLATAFORMA.flatMap((t) => CATALOGO[t].versiones),
    PLANTILLA_CONDICIONES,
  ];

  // Si esto falla, alguien edito un texto. Una version que ya se acepto NO
  // se edita: se agrega un archivo y una version nueva. Solo si la version
  // nunca se publico, anotar el hash nuevo (scripts/hash-textos-legales.js).
  it.each(todas.map((v) => [v.archivo, v]))(
    '%s coincide con el hash anotado',
    (_archivo, v) => {
      expect(sha256(leerTexto(v.archivo))).toBe(v.sha256);
    },
  );

  it('las versiones de cada documento son 1, 2, 3... en orden', () => {
    for (const tipo of DOCUMENTOS_PLATAFORMA) {
      const versiones = CATALOGO[tipo].versiones.map((v) => v.version);
      expect(versiones).toEqual(versiones.map((_, i) => i + 1));
    }
  });

  it('la vigente es la ultima', () => {
    expect(versionVigente('politica_datos')).toBe(
      CATALOGO.politica_datos.versiones.at(-1),
    );
  });

  it('una version publicada (no borrador) no tiene marcas pendientes', () => {
    for (const v of todas.filter((x) => !x.borrador)) {
      expect(marcasPendientes(leerTexto(v.archivo))).toEqual([]);
    }
  });

  it('el admin acepta los terminos; el superadmin, nada', () => {
    expect(documentosDelRol('admin')).toContain('terminos_taller');
    expect(documentosDelRol('cliente')).toEqual([
      'politica_datos',
      'autorizacion_datos',
    ]);
    expect(documentosDelRol('tecnico')).not.toContain('terminos_taller');
    expect(documentosDelRol('superadmin')).toEqual([]);
  });
});

describe('plantilla de condiciones', () => {
  const datos = {
    nombre: 'Taller Centro',
    razonSocial: 'Taller Centro SAS',
    nit: '900123456',
    dv: 7,
    direccion: 'Cra 7 # 12-34',
    municipio: 'Bogota',
    responsableIva: true,
    ventanaHoras: 6,
    vigenciaStrikesMeses: 9,
  };

  it('llena los marcadores con la configuracion del taller', () => {
    const texto = llenarPlantilla(
      leerTexto(PLANTILLA_CONDICIONES.archivo),
      datos,
    );
    expect(texto).toContain('Taller Centro SAS');
    expect(texto).toContain('NIT 900123456-7');
    expect(texto).toContain('hasta 6 horas antes');
    expect(texto).toContain('a los 9 meses');
    expect(texto).toContain('3 strikes vigentes');
    expect(texto).toContain('responsable del IVA');
    expect(texto).not.toMatch(/\{\{/);
  });

  it('lo que el taller no configuro queda como COMPLETAR', () => {
    const texto = llenarPlantilla('{{taller.razon_social}} {{taller.nit}}', {
      ...datos,
      razonSocial: null,
      nit: null,
    });
    expect(marcasPendientes(texto)).toEqual([
      '⟦COMPLETAR: razón social⟧',
      '⟦COMPLETAR: NIT⟧',
    ]);
  });

  it('un marcador desconocido queda y bloquea la publicacion', () => {
    expect(marcasPendientes(llenarPlantilla('{{otro}}', datos))).toEqual([
      '{{otro}}',
    ]);
  });
});
