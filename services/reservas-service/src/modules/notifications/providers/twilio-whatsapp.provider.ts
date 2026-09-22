import { Injectable } from '@nestjs/common';
import { Twilio } from 'twilio';
import {
  EnvioNotificacion,
  NotificationProvider,
} from './notification-provider.interface';

@Injectable()
export class TwilioWhatsappProvider implements NotificationProvider {
  private cliente?: Twilio;

  // El cliente de Twilio se crea recien en el primer enviar(), no en el
  // constructor -- asi el modulo (y por lo tanto el arranque de
  // reservas-service) no explota en dev/test cuando TWILIO_* no esta
  // seteado. Solo revienta si de verdad se intenta mandar un WhatsApp.
  private obtenerCliente(): Twilio {
    if (!this.cliente) {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      if (!accountSid || !authToken) {
        throw new Error(
          'TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN no configurados.',
        );
      }
      this.cliente = new Twilio(accountSid, authToken);
    }
    return this.cliente;
  }

  async enviar({ destinatario, mensaje }: EnvioNotificacion): Promise<void> {
    const from = process.env.TWILIO_WHATSAPP_FROM;
    if (!from) {
      throw new Error('TWILIO_WHATSAPP_FROM no configurado.');
    }

    await this.obtenerCliente().messages.create({
      from: `whatsapp:${from}`,
      to: `whatsapp:${destinatario}`,
      body: mensaje,
    });
  }
}
