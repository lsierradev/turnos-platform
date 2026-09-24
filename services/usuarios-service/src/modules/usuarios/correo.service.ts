import { Injectable, Logger } from '@nestjs/common';
import sgMail from '@sendgrid/mail';
import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

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
      const archivo = this.guardarEnBuzon(correo);
      this.logger.warn(
        `SendGrid sin configurar: correo NO enviado a ${correo.para}.` +
          (archivo
            ? ` Quedo en ${archivo}`
            : `\nAsunto: ${correo.asunto}\n${correo.texto}`),
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

  /**
   * Buzon local de desarrollo (Sprint 19): sin SendGrid, cada correo queda
   * como un .txt en CORREO_BUZON_DIR (default ./.correos fuera de
   * produccion), para abrir el enlace sin buscarlo entre los logs. En
   * produccion no se escribe nada a disco: ahi falta configurar SendGrid.
   */
  private guardarEnBuzon(correo: Correo): string | null {
    const dir =
      process.env.CORREO_BUZON_DIR ??
      (process.env.NODE_ENV === 'production' ? undefined : '.correos');
    if (!dir) return null;
    try {
      mkdirSync(dir, { recursive: true });
      const sello = new Date().toISOString().replace(/[:.]/g, '-');
      const archivo = join(
        dir,
        `${sello}-${correo.para.replace(/[^\w.@-]/g, '_')}.txt`,
      );
      writeFileSync(
        archivo,
        `Para: ${correo.para}\nAsunto: ${correo.asunto}\n\n${correo.texto}\n`,
        'utf8',
      );
      return resolve(archivo);
    } catch (error) {
      this.logger.error(`No se pudo escribir el buzon local: ${String(error)}`);
      return null;
    }
  }
}
