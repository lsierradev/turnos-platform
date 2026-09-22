// UTC explicito en todo el frontend: el backend trabaja con horario laboral
// y ventanas de dia en UTC (ver reservas-service/sugerencias-horarios.util.ts
// y technicians.service.ts), asi que la navegacion de fechas aca sigue la
// misma convencion para no desalinearse con lo que devuelve la API.

export function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function sumarDiasISO(fechaISO: string, dias: number): string {
  const fecha = new Date(`${fechaISO}T00:00:00.000Z`);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

export function formatearHora(iso: string): string {
  return new Date(iso).toISOString().slice(11, 16);
}

export function formatearDiaMes(fechaISO: string): string {
  return `${fechaISO.slice(8, 10)}/${fechaISO.slice(5, 7)}`;
}
