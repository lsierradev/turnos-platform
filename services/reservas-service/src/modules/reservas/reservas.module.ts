import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { NOMBRE_COLA_NOTIFICACIONES } from '../notifications/notifications.constants';
import { ReservasController } from './reservas.controller';
import { ReservasService } from './reservas.service';

// Registra la misma cola que NotificationsModule para poder hacerle ping a
// Redis en el readiness. BullModule.registerQueue es idempotente: dos
// modulos que registran el mismo nombre comparten la instancia.
@Module({
  imports: [BullModule.registerQueue({ name: NOMBRE_COLA_NOTIFICACIONES })],
  controllers: [ReservasController],
  providers: [ReservasService],
})
export class ReservasModule {}
