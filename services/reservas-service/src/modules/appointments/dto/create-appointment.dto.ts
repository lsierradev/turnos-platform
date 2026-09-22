import { IsISO8601, IsUUID } from 'class-validator';

export class CreateAppointmentDto {
  @IsUUID()
  bahiaId: string;

  @IsUUID()
  servicioId: string;

  @IsISO8601()
  inicio: string;
}
