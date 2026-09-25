// Pesos enteros sin decimales; con centavos, siempre dos ("$ 119.999,60",
// nunca "$ 119.999,6").
const PESOS = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});
const PESOS_CON_CENTAVOS = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 8000000 -> "$ 80.000" (centavos a pesos colombianos). */
export function formatearPesos(centavos: number): string {
  return (centavos % 100 === 0 ? PESOS : PESOS_CON_CENTAVOS).format(
    centavos / 100,
  );
}
