import type { ReactNode } from 'react';

/*
 * Texto legal en Markdown (Sprint 23), con el subconjunto que usan los
 * documentos: titulos (#, ##, ###), parrafos, listas (- y 1.), tablas
 * simples, separadores (---) y **negrita**. Las marcas ⟦…⟧ de los
 * borradores se resaltan.
 *
 * Se arma con elementos de React, nunca con innerHTML: las condiciones de
 * un taller las escribe su admin, y un texto con <script> no puede
 * ejecutarse en el navegador del cliente que lo lee.
 */

type Bloque =
  | { tipo: 'titulo'; nivel: 1 | 2 | 3; texto: string }
  | { tipo: 'parrafo'; texto: string }
  | { tipo: 'lista'; ordenada: boolean; items: string[] }
  | { tipo: 'tabla'; filas: string[][] }
  | { tipo: 'separador' };

function bloquesDe(markdown: string): Bloque[] {
  const bloques: Bloque[] = [];
  const lineas = markdown.replace(/\r\n/g, '\n').split('\n');
  let parrafo: string[] = [];
  const cerrarParrafo = () => {
    if (parrafo.length) bloques.push({ tipo: 'parrafo', texto: parrafo.join(' ') });
    parrafo = [];
  };

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i].trimEnd();
    const titulo = /^(#{1,3})\s+(.*)$/.exec(linea);
    const item = /^\s*(-|\d+\.)\s+(.*)$/.exec(linea);
    if (!linea.trim()) {
      cerrarParrafo();
    } else if (titulo) {
      cerrarParrafo();
      bloques.push({ tipo: 'titulo', nivel: titulo[1].length as 1 | 2 | 3, texto: titulo[2] });
    } else if (/^-{3,}$/.test(linea.trim())) {
      cerrarParrafo();
      bloques.push({ tipo: 'separador' });
    } else if (linea.trim().startsWith('|')) {
      cerrarParrafo();
      const filas: string[][] = [];
      while (i < lineas.length && lineas[i].trim().startsWith('|')) {
        const celdas = lineas[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        // La fila |---|---| solo separa el encabezado.
        if (!celdas.every((c) => /^:?-+:?$/.test(c))) filas.push(celdas);
        i++;
      }
      i--;
      bloques.push({ tipo: 'tabla', filas });
    } else if (item) {
      cerrarParrafo();
      const ordenada = item[1] !== '-';
      const anterior = bloques[bloques.length - 1];
      if (anterior?.tipo === 'lista' && anterior.ordenada === ordenada) anterior.items.push(item[2]);
      else bloques.push({ tipo: 'lista', ordenada, items: [item[2]] });
    } else {
      // Continuacion de un item de lista indentado: se suma al ultimo.
      const anterior = bloques[bloques.length - 1];
      if (!parrafo.length && anterior?.tipo === 'lista' && /^\s+/.test(lineas[i])) {
        anterior.items[anterior.items.length - 1] += ` ${linea.trim()}`;
      } else {
        parrafo.push(linea.trim());
      }
    }
  }
  cerrarParrafo();
  return bloques;
}

/** **negrita** y marcas ⟦…⟧ dentro de una linea. */
function enLinea(texto: string): ReactNode[] {
  return texto.split(/(\*\*[^*]+\*\*|⟦[^⟧]*⟧)/g).map((parte, i) => {
    if (parte.startsWith('**') && parte.endsWith('**')) {
      return <strong key={i}>{parte.slice(2, -2)}</strong>;
    }
    if (parte.startsWith('⟦')) {
      return (
        <mark key={i} className="rounded bg-advertencia-suave px-1 text-foreground">
          {parte}
        </mark>
      );
    }
    return parte;
  });
}

export function TextoLegal({
  contenido,
  /** El h1 del documento lo pone la pantalla: los # bajan un nivel. */
  bajarTitulos = false,
}: {
  contenido: string;
  bajarTitulos?: boolean;
}) {
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {bloquesDe(contenido).map((b, i) => {
        switch (b.tipo) {
          case 'titulo': {
            const nivel = Math.min(b.nivel + (bajarTitulos ? 1 : 0), 4);
            const clase =
              nivel <= 1
                ? 'font-heading text-xl font-semibold'
                : nivel === 2
                  ? 'pt-2 font-heading text-lg font-semibold'
                  : 'pt-1 font-semibold';
            const Etiqueta = `h${nivel}` as 'h1' | 'h2' | 'h3' | 'h4';
            return (
              <Etiqueta key={i} className={clase}>
                {enLinea(b.texto)}
              </Etiqueta>
            );
          }
          case 'parrafo':
            return <p key={i}>{enLinea(b.texto)}</p>;
          case 'lista': {
            const Lista = b.ordenada ? 'ol' : 'ul';
            return (
              <Lista key={i} className={`space-y-1 pl-5 ${b.ordenada ? 'list-decimal' : 'list-disc'}`}>
                {b.items.map((item, j) => (
                  <li key={j}>{enLinea(item)}</li>
                ))}
              </Lista>
            );
          }
          case 'tabla': {
            const [encabezado, ...filas] = b.filas;
            return (
              <div key={i} className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr>
                      {encabezado?.map((c, j) => (
                        <th key={j} scope="col" className="border-b p-2 font-semibold">
                          {enLinea(c)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((fila, j) => (
                      <tr key={j} className="border-b last:border-0">
                        {fila.map((c, k) => (
                          <td key={k} className="p-2 align-top">
                            {enLinea(c)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          case 'separador':
            return <hr key={i} className="my-4" />;
        }
      })}
    </div>
  );
}
