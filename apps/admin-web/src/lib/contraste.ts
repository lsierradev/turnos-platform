// Contraste WCAG 2.x en el navegador, para la pagina /design. La
// verificacion que manda es scripts/verificar-contraste.mjs (corre en CI);
// esto solo muestra en vivo los mismos numeros para el tema activo.

function hexARgb(hex: string): [number, number, number] | null {
  const h = hex.trim().replace('#', '');
  const completo =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(completo)) return null;
  return [0, 2, 4].map((i) => parseInt(completo.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

function luminancia(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razon de contraste entre dos colores hex, o null si alguno no se pudo leer. */
export function razonContraste(a: string, b: string): number | null {
  const [ra, rb] = [hexARgb(a), hexARgb(b)];
  if (!ra || !rb) return null;
  const [x, y] = [luminancia(ra), luminancia(rb)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Valor resuelto de una variable CSS (--primary -> "#ea580c"). */
export function leerToken(nombre: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(`--${nombre}`)
    .trim();
}
