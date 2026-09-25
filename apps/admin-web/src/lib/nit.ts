/** Digito de verificacion del NIT (DIAN). Mismo calculo que el backend. */
export function digitoVerificacion(nit: string): number | null {
  if (!/^[0-9]{5,15}$/.test(nit)) return null;
  const primos = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  const suma = nit
    .split('')
    .reverse()
    .reduce((t, d, i) => t + Number(d) * primos[i], 0);
  const resto = suma % 11;
  return resto > 1 ? 11 - resto : resto;
}
