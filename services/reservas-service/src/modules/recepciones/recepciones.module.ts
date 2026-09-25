import { Module } from '@nestjs/common';
import { JwtAuthModule } from '@turnos-platform/auth';
import { NotificationsModule } from '../notifications/notifications.module';
import { VehiculosModule } from '../vehiculos/vehiculos.module';
import {
  OrdenTrabajoController,
  RecepcionesController,
} from './recepciones.controller';
import { RecepcionesService } from './recepciones.service';

@Module({
  imports: [JwtAuthModule, VehiculosModule, NotificationsModule],
  controllers: [OrdenTrabajoController, RecepcionesController],
  providers: [RecepcionesService],
})
export class RecepcionesModule {}
