// Forma de UUID sin exigir version: el backend (ParseUUIDPipe) valida el
// resto, y ser mas estricto aca rechazaria ids que el servidor acepta.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function esUuid(valor: string | undefined): valor is string {
  return valor !== undefined && UUID.test(valor.trim());
}
