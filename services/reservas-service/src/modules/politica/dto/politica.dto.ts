import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class PoliticaDto {
  /** Cancelar o reprogramar gratis hasta N horas antes del turno. */
  @IsInt()
  @Min(0)
  @Max(72)
  ventanaHoras: number;

  /** Cuanto dura un strike (los ya puestos no cambian). */
  @IsInt()
  @Min(1)
  @Max(36)
  vigenciaStrikesMeses: number;
}

export class PoliticaQueryDto {
  /** Solo admin: el estado de ESE cliente (reserva a su nombre). */
  @IsOptional()
  @IsUUID()
  clienteId?: string;
}

export class StrikesQueryDto {
  /**
   * reclamos: con reclamo sin resolver. vigentes: cuentan hoy. todos: los
   * del ultimo ano y medio, incluidos vencidos y anulados.
   */
  @IsOptional()
  @IsIn(['reclamos', 'vigentes', 'todos'])
  estado?: 'reclamos' | 'vigentes' | 'todos';

  @IsOptional()
  @IsUUID()
  clienteId?: string;
}

export class AnularStrikeDto {
  // El cliente la lee: "error" no explica nada.
  @IsString()
  @MinLength(10, {
    message: 'La justificacion tiene que tener al menos 10 caracteres.',
  })
  @MaxLength(1000)
  justificacion: string;
}

export class ReclamoDto {
  @IsString()
  @MinLength(10, { message: 'Contanos que paso (al menos 10 caracteres).' })
  @MaxLength(2000)
  texto: string;
}

export class ResolverReclamoDto {
  /** true: el strike se anula con la respuesta como justificacion. */
  @IsBoolean()
  aceptar: boolean;

  @IsString()
  @MinLength(10, {
    message: 'La respuesta tiene que tener al menos 10 caracteres.',
  })
  @MaxLength(1000)
  respuesta: string;
}
