import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
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
import {
  fechaDeNegocio,
  zonaHorariaNegocio,
} from '../../common/zona-horaria.util';
import { AgendaQueryDto } from './dto/agenda-query.dto';
import { TechniciansService } from './technicians.service';

@Controller('technicians')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TechniciansController {
  constructor(private readonly techniciansService: TechniciansService) {}

  // @Roles no alcanza para esta ruta: el permiso no depende solo del rol
  // sino de DE QUIEN es la agenda. Con @Roles(TECNICO) a secas, cualquier
  // tecnico podria leer la agenda de todos los demas pasando otro id en la
  // URL. El guard filtra por rol y la comprobacion de abajo por pertenencia.
  @Get(':id/agenda')
  @Roles(Rol.ADMIN, Rol.TECNICO)
  agenda(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: AgendaQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    if (user.rol === Rol.TECNICO && user.sub !== id) {
      throw new ForbiddenException('Solo podes consultar tu propia agenda.');
    }

    // ?date=YYYY-MM-DD es el dia del taller. Antes new Date('2026-09-24')
    // lo leia como medianoche UTC, o sea las 19:00 del dia anterior en
    // Bogota.
    const fecha = fechaDeNegocio(query.date, zonaHorariaNegocio());
    return this.techniciansService.agendaDelDia(id, fecha);
  }
}
