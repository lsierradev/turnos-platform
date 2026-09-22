import { Module } from '@nestjs/common';
import { JwtAuthModule } from '@turnos-platform/auth';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

// Sin TypeOrmModule.forFeature: DashboardService no usa repositorios, va
// directo con SQL agregado via DataSource. Traer las filas al proceso para
// contarlas en JS seria el anti-patron exacto que la tarea 3 pide evitar
// (mover miles de turnos por la red para calcular dos numeros).
@Module({
  imports: [JwtAuthModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
