import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, Rol, Roles, RolesGuard } from '@turnos-platform/auth';
import { ActualizarTallerDto, CrearTallerDto } from './talleres.dto';
import { TalleresService } from './talleres.service';

/**
 * Talleres (Sprint 20). Leer: cualquiera con sesion (lo que ve lo decide
 * RLS). Crear y modificar: solo el superadmin de TurnoPro.
 */
@Controller('talleres')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TalleresController {
  constructor(private readonly talleres: TalleresService) {}

  @Get()
  listar() {
    return this.talleres.listar();
  }

  @Post()
  @Roles(Rol.SUPERADMIN)
  crear(@Body() dto: CrearTallerDto) {
    return this.talleres.crear(dto);
  }

  @Patch(':id')
  @Roles(Rol.SUPERADMIN)
  actualizar(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ActualizarTallerDto,
  ) {
    return this.talleres.actualizar(id, dto);
  }
}
