import { IsOptional, Matches } from 'class-validator';

// Solo fecha (YYYY-MM-DD), no un ISO 8601 completo: el rango del dashboard
// es de dias enteros. Aceptar un instante con hora abriria la puerta a
// rangos parciales que el eje de los graficos (una barra por dia) no sabe
// representar. La conversion a la ventana [desde, hasta) en UTC la hace el
// servicio -- ver DashboardService.rangoUtc().
const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export class KpisQueryDto {
  @IsOptional()
  @Matches(FORMATO_FECHA, { message: 'from debe tener el formato YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(FORMATO_FECHA, { message: 'to debe tener el formato YYYY-MM-DD' })
  to?: string;
}
