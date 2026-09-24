import { IsOptional, IsUUID, Matches } from 'class-validator';

// Dia del taller (TZ_NEGOCIO), no un instante: mismo criterio que
// CargaQueryDto y KpisQueryDto.
export class DisponibilidadQueryDto {
  @IsUUID()
  bahiaId: string;

  @IsUUID()
  servicioId: string;

  @IsUUID()
  tecnicoId: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'fecha debe tener el formato YYYY-MM-DD',
  })
  fecha: string;

  // Solo admin (Sprint 17): al reservar a nombre de un cliente, que la
  // grilla descuente los turnos de ESE cliente y no los del admin.
  @IsOptional()
  @IsUUID()
  clienteId?: string;
}
