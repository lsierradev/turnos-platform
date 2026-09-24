/**
 * Helpers de ventanas de tiempo sobre `turnos`.
 *
 * Donde empieza y termina un DIA ya no se decide aca: desde Sprint 12 los
 * dias son del taller (TZ_NEGOCIO), ver zona-horaria.util.ts.
 */

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
