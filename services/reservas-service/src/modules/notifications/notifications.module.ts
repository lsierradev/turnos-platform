import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notificacion } from './entities/notificacion.entity';
import { NOMBRE_COLA_NOTIFICACIONES } from './notifications.constants';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationsSchedulerService } from './notifications-scheduler.service';
import { SendgridEmailProvider } from './providers/sendgrid-email.provider';
import { TwilioWhatsappProvider } from './providers/twilio-whatsapp.provider';
import { EMAIL_PROVIDER, WHATSAPP_PROVIDER } from './providers/provider.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notificacion]),
    BullModule.registerQueue({ name: NOMBRE_COLA_NOTIFICACIONES }),
  ],
  providers: [
    NotificationsSchedulerService,
    NotificationsProcessor,
    { provide: EMAIL_PROVIDER, useClass: SendgridEmailProvider },
    { provide: WHATSAPP_PROVIDER, useClass: TwilioWhatsappProvider },
  ],
})
export class NotificationsModule {}
