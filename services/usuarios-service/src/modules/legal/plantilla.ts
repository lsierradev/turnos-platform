/*
 * Plantilla de condiciones taller-cliente (Sprint 23): los {{marcadores}}
 * se llenan con lo que el taller ya configuro (datos fiscales, politica de
 * cancelacion). Lo que falta queda como ⟦COMPLETAR: …⟧, que bloquea la
 * publicacion hasta que el admin lo complete en el texto o en su
 * configuracion.
 */

/**
 * Strikes vigentes que obligan a pagar el 100 % por adelantado. Espeja
 * STRIKES_PARA_PREPAGO de reservas-service (common/politica-cancelacion.util.ts): si cambia
 * alla, cambia aca, o las condiciones publicadas dirian otra cosa que la
 * regla que se aplica.
 */
export const STRIKES_PARA_PREPAGO = 3;

export interface DatosPlantilla {
  nombre: string;
  razonSocial: string | null;
  nit: string | null;
  dv: number | null;
  direccion: string | null;
  municipio: string | null;
  responsableIva: boolean;
  ventanaHoras: number;
  vigenciaStrikesMeses: number;
}

const completar = (que: string) => `⟦COMPLETAR: ${que}⟧`;

export function llenarPlantilla(texto: string, d: DatosPlantilla): string {
  const valores: Record<string, string> = {
    'taller.nombre': d.nombre,
    'taller.razon_social': d.razonSocial?.trim() || completar('razón social'),
    'taller.nit': d.nit
      ? d.dv === null
        ? d.nit
        : `${d.nit}-${d.dv}`
      : completar('NIT'),
    'taller.direccion': d.direccion?.trim() || completar('dirección'),
    'taller.municipio': d.municipio?.trim() || completar('municipio'),
    'taller.iva': d.responsableIva
      ? 'responsable del IVA'
      : 'no responsable del IVA, por lo que sus precios no lo discriminan',
    'politica.ventana_horas': String(d.ventanaHoras),
    'politica.vigencia_strikes_meses': String(d.vigenciaStrikesMeses),
    'politica.strikes_para_prepago': String(STRIKES_PARA_PREPAGO),
  };
  // Un marcador desconocido queda tal cual: marcasPendientes lo detecta y
  // no deja publicar.
  return texto.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (marca, clave: string) =>
    clave in valores ? valores[clave] : marca,
  );
}
