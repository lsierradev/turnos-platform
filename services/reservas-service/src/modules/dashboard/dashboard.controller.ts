import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, Rol, Roles, RolesGuard } from '@turnos-platform/auth';
import { DashboardService } from './dashboard.service';
import { KpisQueryDto } from './dto/kpis-query.dto';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
// La HU es explicita: "Como Administrador quiero ver un dashboard". Son
// metricas de negocio del taller entero, no datos operativos de un turno.
@Roles(Rol.ADMIN)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('kpis')
  kpis(@Query() query: KpisQueryDto) {
    return this.dashboardService.kpis(query);
  }
}
