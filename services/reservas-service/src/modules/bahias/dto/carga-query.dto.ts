import { IsOptional, Matches } from 'class-validator';

// Dias del taller (TZ_NEGOCIO), no instantes: mismo criterio que
// KpisQueryDto. La conversion a la ventana [desde, hasta) la hace el
// servicio.
const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export class CargaQueryDto {
  @IsOptional()
  @Matches(FORMATO_FECHA, { message: 'desde debe tener el formato YYYY-MM-DD' })
  desde?: string;

  @IsOptional()
  @Matches(FORMATO_FECHA, { message: 'hasta debe tener el formato YYYY-MM-DD' })
  hasta?: string;
}

export class TurnosBahiaQueryDto {
  @IsOptional()
  @Matches(FORMATO_FECHA, { message: 'fecha debe tener el formato YYYY-MM-DD' })
  fecha?: string;
}
