import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  CurrentUser,
  JwtAuthGuard,
  JwtPayload,
  Rol,
  Roles,
  RolesGuard,
} from '@turnos-platform/auth';
import { DashboardService } from './dashboard.service';
import { KpisQueryDto } from './dto/kpis-query.dto';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  // Admin: el taller entero, o un tecnico si pasa ?tecnicoId. Tecnico
  // (Sprint 18): SIEMPRE los suyos -- el tecnicoId del query se ignora y se
  // reemplaza por el del token, igual criterio que la agenda: el permiso
  // depende de DE QUIEN son los datos, no solo del rol. Un cliente sigue
  // sin acceso (403).
  @Get('kpis')
  @Roles(Rol.ADMIN, Rol.TECNICO)
  kpis(@Query() query: KpisQueryDto, @CurrentUser() user: JwtPayload) {
    const tecnicoId = user.rol === Rol.TECNICO ? user.sub : query.tecnicoId;
    return this.dashboardService.kpis({ ...query, tecnicoId });
  }
}
