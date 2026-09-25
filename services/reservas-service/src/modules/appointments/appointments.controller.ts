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
import {
  CancelarTurnoDto,
  FinalizarAtencionDto,
  NotasAtencionDto,
  ReprogramarTurnoDto,
} from './dto/ciclo-turno.dto';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { DisponibilidadQueryDto } from './dto/disponibilidad-query.dto';
import { ReasignarTecnicoDto } from './dto/reasignar-tecnico.dto';

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
  // Sprint 21: turnos que vienen sin tecnico (el suyo se dio de baja).
  @Get('sin-tecnico')
  @Roles(Rol.ADMIN)
  sinTecnico() {
    return this.appointmentsService.sinTecnico();
  }

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
    // El turno queda a nombre de un cliente si lo reservo el mismo o si el
    // admin lo hizo por el: en los dos casos se lo relaciona con el taller.
    const titularEsCliente = paraCliente || user.rol === Rol.CLIENTE;
    return this.appointmentsService.create(
      dto,
      usuarioId,
      paraCliente,
      titularEsCliente,
    );
  }

  // Cerrar un turno no es una accion del cliente: define la tasa de
  // asistencia y el tiempo de servicio que despues lee el dashboard. Un
  // cliente pudiendo marcarse "atendido" a si mismo falsea los KPIs.
  @Patch(':id/tecnico')
  @Roles(Rol.ADMIN)
  reasignarTecnico(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReasignarTecnicoDto,
  ) {
    return this.appointmentsService.reasignarTecnico(id, dto.tecnicoId);
  }

  // Sprint 22: el tecnico cierra solo SUS turnos pendientes (atendido o
  // no asistio); corregir un cierre o cancelar por aca es del admin.
  @Patch(':id/estado')
  @Roles(Rol.ADMIN, Rol.TECNICO)
  actualizarEstado(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ActualizarEstadoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.appointmentsService.actualizarEstado(id, dto, user);
  }

  // Politica de cancelacion (Sprint 22). El cliente, los suyos (gratis
  // hasta la ventana del taller; despues, strike). El admin, cualquiera
  // del taller, diciendo si lo pidio el cliente o lo decidio el taller.
  // El tecnico no: si no puede atender, el que cancela es el taller.
  @Post(':id/cancelar')
  @Roles(Rol.CLIENTE, Rol.ADMIN)
  cancelar(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CancelarTurnoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.appointmentsService.cancelar(id, dto, user);
  }

  @Post(':id/reprogramar')
  @Roles(Rol.CLIENTE, Rol.ADMIN)
  reprogramar(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReprogramarTurnoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.appointmentsService.reprogramar(id, dto, user);
  }

  // Orden de trabajo (Sprint 22): el tecnico registra inicio, fin y notas
  // de SUS turnos; el admin, de cualquiera del taller.
  @Post(':id/atencion/inicio')
  @Roles(Rol.ADMIN, Rol.TECNICO)
  iniciarAtencion(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.appointmentsService.iniciarAtencion(id, user);
  }

  @Post(':id/atencion/fin')
  @Roles(Rol.ADMIN, Rol.TECNICO)
  finalizarAtencion(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: FinalizarAtencionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.appointmentsService.finalizarAtencion(id, dto, user);
  }

  @Patch(':id/notas')
  @Roles(Rol.ADMIN, Rol.TECNICO)
  actualizarNotas(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: NotasAtencionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.appointmentsService.actualizarNotas(id, dto.notas, user);
  }
}
