import { Injectable } from '@nestjs/common';
import sgMail from '@sendgrid/mail';
import {
  EnvioNotificacion,
  NotificationProvider,
} from './notification-provider.interface';

@Injectable()
export class SendgridEmailProvider implements NotificationProvider {
  private inicializado = false;

  // Mismo motivo que TwilioWhatsappProvider: el SDK se configura recien al
  // primer enviar(), no en el constructor, para no romper el arranque del
  // servicio si SENDGRID_API_KEY no esta seteada en dev/test.
  private asegurarInicializado(): void {
    if (this.inicializado) {
      return;
    }
    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) {
      throw new Error('SENDGRID_API_KEY no configurada.');
    }
    sgMail.setApiKey(apiKey);
    this.inicializado = true;
  }

  async enviar({ destinatario, mensaje }: EnvioNotificacion): Promise<void> {
    this.asegurarInicializado();

    const from = process.env.SENDGRID_FROM_EMAIL;
    if (!from) {
      throw new Error('SENDGRID_FROM_EMAIL no configurado.');
    }

    await sgMail.send({
      to: destinatario,
      from,
      subject: 'Recordatorio de turno',
      text: mensaje,
    });
  }
}
