import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@turnos-platform/auth';
import { AgendaQueryDto } from './dto/agenda-query.dto';
import { TechniciansService } from './technicians.service';

@Controller('technicians')
@UseGuards(JwtAuthGuard)
export class TechniciansController {
  constructor(private readonly techniciansService: TechniciansService) {}

  @Get(':id/agenda')
  agenda(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: AgendaQueryDto,
  ) {
    const fecha = query.date ? new Date(query.date) : new Date();
    return this.techniciansService.agendaDelDia(id, fecha);
  }
}
