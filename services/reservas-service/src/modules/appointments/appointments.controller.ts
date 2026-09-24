import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
import { DisponibilidadQueryDto } from './dto/disponibilidad-query.dto';

@Controller('appointments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  // Grilla del formulario de reserva. Abierta a cualquier autenticado,
  // igual que el POST: el usuario del token entra en el calculo (no se le
  // ofrecen horarios en los que ya tiene otro turno).
  @Get('disponibilidad')
  async disponibilidad(
    @Query() query: DisponibilidadQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const { usuarioId } = await this.appointmentsService.resolverTitular(
      user,
      query.clienteId,
    );
    return this.appointmentsService.disponibilidad(query, usuarioId);
  }

  // Los turnos de quien pregunta, sin parametros: no hay forma de pedir
  // los de otro (Sprint 18, vista del cliente).
  @Get('mios')
  misTurnos(@CurrentUser() user: JwtPayload) {
    return this.appointmentsService.misTurnos(user.sub);
  }

  @Post()
  async create(
    @Body() dto: CreateAppointmentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const { usuarioId, paraCliente } =
      await this.appointmentsService.resolverTitular(user, dto.clienteId);
    return this.appointmentsService.create(dto, usuarioId, paraCliente);
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
