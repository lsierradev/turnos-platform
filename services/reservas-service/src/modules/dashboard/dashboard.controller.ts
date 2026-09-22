import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@turnos-platform/auth';
import { DashboardService } from './dashboard.service';
import { KpisQueryDto } from './dto/kpis-query.dto';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('kpis')
  kpis(@Query() query: KpisQueryDto) {
    return this.dashboardService.kpis(query);
  }
}
