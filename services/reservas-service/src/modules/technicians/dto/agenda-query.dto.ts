import { IsISO8601, IsOptional } from 'class-validator';

export class AgendaQueryDto {
  @IsOptional()
  @IsISO8601()
  date?: string;
}
