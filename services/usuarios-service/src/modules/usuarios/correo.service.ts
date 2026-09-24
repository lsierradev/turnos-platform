import { Injectable, Logger } from '@nestjs/common';
import sgMail from '@sendgrid/mail';

export interface Correo {
  para: string;
  asunto: string;
  texto: string;
}

/**
 * Envio de correos de usuarios-service (Sprint 18: enlaces de contrasena).
 *
 * Con SENDGRID_API_KEY y SENDGRID_FROM_EMAIL manda por SendGrid, igual que
 * los recordatorios de reservas-service. Sin ellas (dev, CI) NO falla: deja
 * el correo en el log, para poder copiar el enlace a mano. Que el alta de un
 * cliente dependa de tener SendGrid configurado en una maquina de desarrollo
 * seria un obstaculo sin beneficio.
 *
 * Por eso mismo, en produccion hay que configurarlas: sin ellas nadie recibe
 * el enlace (queda en el log del servidor).
 */
@Injectable()
export class CorreoService {
  private readonly logger = new Logger(CorreoService.name);
  private inicializado = false;

  /** true si el correo salio de verdad; false si solo quedo en el log. */
  async enviar(correo: Correo): Promise<boolean> {
    const apiKey = process.env.SENDGRID_API_KEY;
    const from = process.env.SENDGRID_FROM_EMAIL;
    if (!apiKey || !from) {
      this.logger.warn(
        `SendGrid sin configurar: correo NO enviado a ${correo.para}.\n` +
          `Asunto: ${correo.asunto}\n${correo.texto}`,
      );
      return false;
    }

    if (!this.inicializado) {
      sgMail.setApiKey(apiKey);
      this.inicializado = true;
    }
    await sgMail.send({
      to: correo.para,
      from,
      subject: correo.asunto,
      text: correo.texto,
    });
    return true;
  }
}
