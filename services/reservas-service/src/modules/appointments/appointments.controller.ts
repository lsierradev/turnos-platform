import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, JwtAuthGuard, JwtPayload } from '@turnos-platform/auth';
import { AppointmentsService } from './appointments.service';
import { ActualizarEstadoDto } from './dto/actualizar-estado.dto';
import { CreateAppointmentDto } from './dto/create-appointment.dto';

@Controller('appointments')
@UseGuards(JwtAuthGuard)
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Post()
  create(@Body() dto: CreateAppointmentDto, @CurrentUser() user: JwtPayload) {
    return this.appointmentsService.create(dto, user.sub);
  }

  @Patch(':id/estado')
  actualizarEstado(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ActualizarEstadoDto,
  ) {
    return this.appointmentsService.actualizarEstado(id, dto);
  }
}
