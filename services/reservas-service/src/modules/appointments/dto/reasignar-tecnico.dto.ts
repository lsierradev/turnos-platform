import { IsUUID } from 'class-validator';

export class ReasignarTecnicoDto {
  @IsUUID()
  tecnicoId: string;
}
