import { Module } from '@nestjs/common';
import { JwtAuthModule } from '@turnos-platform/auth';
import { InventarioModule } from '../inventario/inventario.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PoliticaModule } from '../politica/politica.module';
import { ServiciosModule } from '../servicios/servicios.module';
import { VentasController } from './ventas.controller';
import { VentasService } from './ventas.service';

@Module({
  imports: [InventarioModule, ServiciosModule, PoliticaModule, NotificationsModule, JwtAuthModule],
  controllers: [VentasController],
  providers: [VentasService],
})
export class VentasModule {}
