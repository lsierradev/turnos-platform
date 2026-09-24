import { IsOptional, IsUUID, Matches } from 'class-validator';

// Solo fecha (YYYY-MM-DD), no un ISO 8601 completo: el rango del dashboard
// es de dias enteros. Aceptar un instante con hora abriria la puerta a
// rangos parciales que el eje de los graficos (una barra por dia) no sabe
// representar. Son dias del taller (TZ_NEGOCIO); la conversion a la ventana
// [desde, hasta) la hace el servicio -- ver DashboardService.rango().
const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export class KpisQueryDto {
  @IsOptional()
  @Matches(FORMATO_FECHA, { message: 'from debe tener el formato YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(FORMATO_FECHA, { message: 'to debe tener el formato YYYY-MM-DD' })
  to?: string;

  // Sprint 18: KPIs de un solo tecnico. Un admin lo elige; para el rol
  // tecnico el controller lo pisa con su propio id.
  @IsOptional()
  @IsUUID()
  tecnicoId?: string;
}
