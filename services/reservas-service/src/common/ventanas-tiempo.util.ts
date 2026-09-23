/**
 * Helpers de ventanas de tiempo en UTC explicito.
 *
 * UTC y no hora local del proceso: el backend delimita dias asi en todos
 * lados (ver technicians.service.ts, sugerencias-horarios.util.ts y
 * dashboard.service.ts). Usar setHours/setDate correria la ventana en
 * cualquier servidor que no corra en UTC.
 */

export function inicioDelDiaUtc(fecha: Date): Date {
  const dia = new Date(fecha);
  dia.setUTCHours(0, 0, 0, 0);
  return dia;
}

export function sumarDiasUtc(fecha: Date, dias: number): Date {
  const resultado = new Date(fecha);
  resultado.setUTCDate(resultado.getUTCDate() + dias);
  return resultado;
}

/**
 * Condicion SQL para traer de `turnos` solo los que tocan una ventana.
 *
 * Usa el operador de solapamiento de rangos (`&&`), que es lo que saben
 * resolver los indices GiST que ya existen sobre (bahia_id, rango_tiempo) y
 * (tecnico_id, rango_tiempo) -- creados en 001 y 006 para las constraints
 * EXCLUDE, y reutilizables tal cual para filtrar por fecha.
 *
 * Es un SUPERCONJUNTO de "empieza dentro de la ventana": un turno que
 * arranco antes y termina adentro tambien solapa. Quien necesite la
 * semantica exacta de "empieza dentro" tiene que refinar despues; para
 * acotar cuanto se trae de la base, que sea superconjunto es justamente lo
 * que lo hace seguro.
 */
export const SQL_SOLAPA_VENTANA =
  "rango_tiempo && tstzrange(:desde, :hasta, '[)')";
