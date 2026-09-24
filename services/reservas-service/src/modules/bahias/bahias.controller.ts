import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, Rol, Roles, RolesGuard } from '@turnos-platform/auth';
import { BahiasService } from './bahias.service';
import { CargaQueryDto, TurnosBahiaQueryDto } from './dto/carga-query.dto';

@Controller('bahias')
@UseGuards(JwtAuthGuard, RolesGuard)
// Carga de trabajo del taller entero y turnos con nombre de clientes: vista
// de administracion, igual que el dashboard.
@Roles(Rol.ADMIN)
export class BahiasController {
  constructor(private readonly bahiasService: BahiasService) {}

  @Get('carga')
  carga(@Query() query: CargaQueryDto) {
    return this.bahiasService.carga(query);
  }

  @Get(':id/turnos')
  turnos(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: TurnosBahiaQueryDto,
  ) {
    return this.bahiasService.turnosDeBahia(id, query.fecha);
  }
}
