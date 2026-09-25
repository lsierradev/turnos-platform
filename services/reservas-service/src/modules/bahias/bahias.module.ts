import { Module } from '@nestjs/common';
import { JwtAuthModule } from '@turnos-platform/auth';
import { ConfiguracionModule } from '../configuracion/configuracion.module';
import { BahiasController } from './bahias.controller';
import { BahiasService } from './bahias.service';

// Igual que DashboardModule: SQL agregado via DataSource, sin repositorios
// (contar turnos trayendolos al proceso seria mover miles de filas para
// calcular unos pocos numeros). RedisCacheModule es @Global.
@Module({
  imports: [JwtAuthModule, ConfiguracionModule],
  controllers: [BahiasController],
  providers: [BahiasService],
})
export class BahiasModule {}
