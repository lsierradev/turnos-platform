import { sumarDiasFecha } from '../../common/zona-horaria.util';
import { diaSemanaIso } from '../../common/horario.util';

/**
 * Festivos nacionales de Colombia de un ano (Ley 51 de 1983, "Ley
 * Emiliani", y los que dependen de la Pascua). Sirve para que el taller los
 * cargue de una vez; despues puede borrar los que atienda.
 *
 * - Fijos: se celebran el dia que caen.
 * - Emiliani: si no caen lunes, pasan al lunes siguiente.
 * - Pascua: Jueves y Viernes Santo fijos respecto de la Pascua; Ascension,
 *   Corpus Christi y Sagrado Corazon se corren al lunes (quedan a 43, 64 y
 *   71 dias del domingo de Pascua).
 */

export interface Festivo {
  fecha: string;
  motivo: string;
}

function fecha(anio: number, mes: number, dia: number): string {
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Domingo de Pascua (algoritmo anonimo gregoriano, Meeus/Jones/Butcher). */
export function domingoDePascua(anio: number): string {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return fecha(anio, mes, dia);
}

/** El mismo dia si es lunes; si no, el lunes siguiente. */
function alLunes(fechaISO: string): string {
  const dia = diaSemanaIso(fechaISO);
  return dia === 1 ? fechaISO : sumarDiasFecha(fechaISO, 8 - dia);
}

export function festivosDeColombia(anio: number): Festivo[] {
  const pascua = domingoDePascua(anio);
  const festivos: Festivo[] = [
    { fecha: fecha(anio, 1, 1), motivo: 'Año Nuevo' },
    { fecha: alLunes(fecha(anio, 1, 6)), motivo: 'Día de los Reyes Magos' },
    { fecha: alLunes(fecha(anio, 3, 19)), motivo: 'Día de San José' },
    { fecha: sumarDiasFecha(pascua, -3), motivo: 'Jueves Santo' },
    { fecha: sumarDiasFecha(pascua, -2), motivo: 'Viernes Santo' },
    { fecha: fecha(anio, 5, 1), motivo: 'Día del Trabajo' },
    { fecha: sumarDiasFecha(pascua, 43), motivo: 'Ascensión del Señor' },
    { fecha: sumarDiasFecha(pascua, 64), motivo: 'Corpus Christi' },
    { fecha: sumarDiasFecha(pascua, 71), motivo: 'Sagrado Corazón' },
    { fecha: alLunes(fecha(anio, 6, 29)), motivo: 'San Pedro y San Pablo' },
    { fecha: fecha(anio, 7, 20), motivo: 'Día de la Independencia' },
    { fecha: fecha(anio, 8, 7), motivo: 'Batalla de Boyacá' },
    { fecha: alLunes(fecha(anio, 8, 15)), motivo: 'Asunción de la Virgen' },
    { fecha: alLunes(fecha(anio, 10, 12)), motivo: 'Día de la Raza' },
    { fecha: alLunes(fecha(anio, 11, 1)), motivo: 'Todos los Santos' },
    {
      fecha: alLunes(fecha(anio, 11, 11)),
      motivo: 'Independencia de Cartagena',
    },
    { fecha: fecha(anio, 12, 8), motivo: 'Inmaculada Concepción' },
    { fecha: fecha(anio, 12, 25), motivo: 'Navidad' },
  ];
  return festivos.sort((x, y) => x.fecha.localeCompare(y.fecha));
}
