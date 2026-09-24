// Exportacion a CSV (Sprint 18).
//
// Punto y coma como separador y coma decimal: es lo que espera Excel con la
// configuracion regional de Colombia/Latinoamerica. Con coma como separador,
// ese Excel mete toda la fila en una sola celda. El BOM hace que Excel lea
// el archivo como UTF-8 (sin el, "asistió" sale como "asistiÃ³").

export type Celda = string | number | null;

const SEPARADOR = ';';

function celda(valor: Celda): string {
  if (valor === null) return '';
  const texto = typeof valor === 'number' ? String(valor).replace('.', ',') : valor;
  // Comillas si el texto trae el separador, comillas o saltos de linea.
  return /[";\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

export function aCsv(filas: Celda[][]): string {
  return filas.map((fila) => fila.map(celda).join(SEPARADOR)).join('\r\n');
}

export function descargarCsv(nombreArchivo: string, contenido: string): void {
  const blob = new Blob(['﻿', contenido], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(url);
}
