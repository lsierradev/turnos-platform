import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  CurrentUser,
  JwtAuthGuard,
  JwtPayload,
  Rol,
  Roles,
  RolesGuard,
} from '@turnos-platform/auth';
import { AppointmentsService } from './appointments.service';
import { ActualizarEstadoDto } from './dto/actualizar-estado.dto';
import { CreateAppointmentDto } from './dto/create-appointment.dto';

@Controller('appointments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Post()
  create(@Body() dto: CreateAppointmentDto, @CurrentUser() user: JwtPayload) {
    return this.appointmentsService.create(dto, user.sub);
  }

  // Cerrar un turno no es una accion del cliente: define la tasa de
  // asistencia y el tiempo de servicio que despues lee el dashboard. Un
  // cliente pudiendo marcarse "atendido" a si mismo falsea los KPIs.
  @Patch(':id/estado')
  @Roles(Rol.ADMIN, Rol.TECNICO)
  actualizarEstado(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ActualizarEstadoDto,
  ) {
    return this.appointmentsService.actualizarEstado(id, dto);
  }
}
