import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * Quien pidio cancelar o reprogramar, cuando lo hace el personal. Un
 * cliente que llama por telefono para cancelar tarde es una cancelacion
 * del cliente (suma strike); si el taller no puede atender, es del taller
 * y nunca suma. Para el cliente logueado no se lee: siempre es 'cliente'.
 */
export type SolicitadoPor = 'cliente' | 'taller';

export class CancelarTurnoDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  motivo?: string;

  @IsOptional()
  @IsIn(['cliente', 'taller'])
  solicitadoPor?: SolicitadoPor;
}

export class ReprogramarTurnoDto {
  /** Nuevo inicio (instante ISO). Servicio y vehiculo se conservan. */
  @IsISO8601()
  inicio: string;

  /** Si no viene, la misma bahia. */
  @IsOptional()
  @IsUUID()
  bahiaId?: string;

  /** Si no viene, el mismo tecnico (obligatorio si el turno no tiene). */
  @IsOptional()
  @IsUUID()
  tecnicoId?: string;

  @IsOptional()
  @IsIn(['cliente', 'taller'])
  solicitadoPor?: SolicitadoPor;
}

export class NotasAtencionDto {
  @IsString()
  @MaxLength(4000)
  notas: string;
}

export class FinalizarAtencionDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notas?: string;
}
