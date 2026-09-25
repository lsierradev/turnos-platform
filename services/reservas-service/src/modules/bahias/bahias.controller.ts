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
import { JwtAuthGuard, Rol, Roles, RolesGuard } from '@turnos-platform/auth';
import { BahiasService } from './bahias.service';
import { ActualizarBahiaDto, BahiaDto } from './dto/bahia.dto';
import { CargaQueryDto, TurnosBahiaQueryDto } from './dto/carga-query.dto';

@Controller('bahias')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BahiasController {
  constructor(private readonly bahiasService: BahiasService) {}

  // Solo id y nombre de las bahias en servicio: lo que necesita el
  // formulario de reserva para elegir una. Abierto a cualquier autenticado,
  // como GET /servicios. Por eso @Roles va en cada metodo y no en la clase:
  // RolesGuard usa getAllAndOverride y un @Roles de clase no se puede
  // "abrir" desde un metodo sin roles.
  @Get()
  listar() {
    return this.bahiasService.listarActivas();
  }

  // Catalogo del admin (Sprint 21): tambien las fuera de servicio.
  @Get('todas')
  @Roles(Rol.ADMIN)
  listarTodas() {
    return this.bahiasService.listarTodas();
  }

  @Post()
  @Roles(Rol.ADMIN)
  crear(@Body() dto: BahiaDto) {
    return this.bahiasService.crear(dto);
  }

  @Patch(':id')
  @Roles(Rol.ADMIN)
  actualizar(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ActualizarBahiaDto,
  ) {
    return this.bahiasService.actualizar(id, dto);
  }

  // Carga de trabajo del taller entero y turnos con nombre de clientes:
  // vista de administracion, igual que el dashboard.
  @Get('carga')
  @Roles(Rol.ADMIN)
  carga(@Query() query: CargaQueryDto) {
    return this.bahiasService.carga(query);
  }

  @Get(':id/turnos')
  @Roles(Rol.ADMIN)
  turnos(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: TurnosBahiaQueryDto,
  ) {
    return this.bahiasService.turnosDeBahia(id, query.fecha);
  }
}
