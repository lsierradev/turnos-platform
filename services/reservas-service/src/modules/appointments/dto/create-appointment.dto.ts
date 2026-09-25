import { IsISO8601, IsOptional, IsUUID } from 'class-validator';

export class CreateAppointmentDto {
  @IsUUID()
  bahiaId: string;

  @IsUUID()
  servicioId: string;

  @IsUUID()
  tecnicoId: string;

  @IsISO8601()
  inicio: string;

  // Solo admin (Sprint 17): reservar a nombre de un cliente, p. ej. uno que
  // llama por telefono. Sin esto el turno queda a nombre de quien reserva.
  @IsOptional()
  @IsUUID()
  clienteId?: string;

  // Sprint 22: el vehiculo que trae (del titular del turno). Opcional al
  // reservar; la recepcion lo pide si falta.
  @IsOptional()
  @IsUUID()
  vehiculoId?: string;
}
