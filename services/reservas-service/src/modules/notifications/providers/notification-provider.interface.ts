export interface EnvioNotificacion {
  destinatario: string;
  mensaje: string;
  /** Solo correo; WhatsApp no tiene asunto. */
  asunto?: string;
}

/**
 * Interfaz comun para cualquier canal de envio. NotificationsProcessor solo
 * conoce esto -- cambiar de proveedor (o agregar un canal nuevo) es escribir
 * una clase que la implemente y rebindear el token correspondiente en
 * NotificationsModule, sin tocar el processor.
 */
export interface NotificationProvider {
  enviar(envio: EnvioNotificacion): Promise<void>;
}
