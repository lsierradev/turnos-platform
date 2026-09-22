import { IsEnum, IsISO8601, IsOptional } from 'class-validator';
import { EstadoTurno } from '../../../entities/turno.entity';

export class ActualizarEstadoDto {
  @IsEnum(EstadoTurno)
  estado: EstadoTurno;

  // Horas reales de atencion. Opcionales incluso cuando estado='atendido':
  // no todos los talleres cronometran. Un turno atendido sin estas dos
  // fechas cuenta para la tasa de asistencia y queda fuera del promedio de
  // duracion (GET /dashboard/kpis expone `turnosMedidos` para que se vea
  // sobre cuantas filas se calculo ese promedio).
  @IsOptional()
  @IsISO8601()
  atencionInicio?: string;

  @IsOptional()
  @IsISO8601()
  atencionFin?: string;
}
