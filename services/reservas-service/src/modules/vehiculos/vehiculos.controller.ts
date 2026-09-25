import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
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
  RolesGuard,
} from '@turnos-platform/auth';
import {
  ActualizarVehiculoDto,
  VehiculoDto,
  VehiculosQueryDto,
} from './dto/vehiculo.dto';
import { VehiculosService } from './vehiculos.service';

/**
 * Vehiculos (Sprint 22). El cliente administra los suyos; el personal del
 * taller los de sus clientes (en la recepcion, si el cliente no lo cargo).
 */
@Controller('vehiculos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VehiculosController {
  constructor(private readonly vehiculos: VehiculosService) {}

  private rechazarAjeno(user: JwtPayload, clienteId?: string) {
    if (user.rol === Rol.CLIENTE && clienteId && clienteId !== user.sub) {
      throw new ForbiddenException(
        'Solo el personal del taller carga vehiculos de otro usuario.',
      );
    }
  }

  @Get()
  async listar(
    @Query() query: VehiculosQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    this.rechazarAjeno(user, query.clienteId);
    return this.vehiculos.listar(
      await this.vehiculos.titular(user, query.clienteId),
    );
  }

  @Post()
  async crear(@Body() dto: VehiculoDto, @CurrentUser() user: JwtPayload) {
    this.rechazarAjeno(user, dto.clienteId);
    return this.vehiculos.crear(
      dto,
      await this.vehiculos.titular(user, dto.clienteId),
    );
  }

  // RLS decide si la sesion lo ve (propio o de un cliente del taller).
  @Patch(':id')
  actualizar(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ActualizarVehiculoDto,
  ) {
    return this.vehiculos.actualizar(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  baja(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.vehiculos.baja(id);
  }
}
