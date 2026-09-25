/**
 * Digito de verificacion del NIT (DIAN, Orden Administrativa 4 de 1989):
 * cada digito, de derecha a izquierda, por un primo de la serie; el
 * resultado es 11 - (suma mod 11), salvo que el resto sea 0 o 1.
 */
const PRIMOS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

export function digitoVerificacion(nit: string): number {
  if (!/^[0-9]{1,15}$/.test(nit)) {
    throw new RangeError(`NIT invalido: ${nit}`);
  }
  let suma = 0;
  const digitos = nit.split('').reverse();
  digitos.forEach((d, i) => {
    suma += Number(d) * PRIMOS[i];
  });
  const resto = suma % 11;
  return resto > 1 ? 11 - resto : resto;
}

/** "900.123.456-7" o "900123456" -> solo digitos, sin el DV. */
export function normalizarNit(entrada: string): string {
  return entrada.replace(/[.\s]/g, '').split('-')[0];
}
