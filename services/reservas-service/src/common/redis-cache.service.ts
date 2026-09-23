import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Cache de lecturas con TTL corto, compartido entre instancias.
 *
 * Existe por el criterio de aceptacion "desfase del panel admin < 5 s"
 * (SRS 14). Cumplirlo por polling significa que cada panel abierto dispara
 * su propia agregacion sobre `turnos`, que es la tabla caliente del motor de
 * reservas: con N paneles, N veces el costo. Con este cache el costo queda
 * acotado a una consulta por TTL sin importar cuantos paneles haya.
 *
 * REGLA: un fallo del cache NUNCA puede romper la lectura. Si Redis no
 * responde, se cae a la consulta real. El cache es una optimizacion, no una
 * dependencia del dashboard -- convertirlo en dependencia empeoraria la
 * disponibilidad en vez de mejorarla, que es lo contrario de lo que busca
 * el criterio de SLA.
 */
@Injectable()
export class RedisCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private readonly cliente: Redis | null;

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL');

    if (!url) {
      // Sin REDIS_URL el servicio funciona igual, solo que sin cache. Es el
      // caso de los tests unitarios y de un dev que no levanto Redis.
      this.logger.warn('REDIS_URL no definida: el cache queda deshabilitado.');
      this.cliente = null;
      return;
    }

    this.cliente = new Redis(url, {
      // Sin cola offline y con un solo reintento: si Redis no esta, se
      // quiere fallar en milisegundos y seguir de largo hacia la DB, no
      // encolar comandos que van a resolver tarde.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      lazyConnect: false,
    });

    // ioredis emite 'error' en cada reintento de reconexion. Sin listener,
    // Node lo trata como excepcion no capturada y tumba el proceso: un
    // Redis caido pasaria de "sin cache" a "servicio caido".
    this.cliente.on('error', (error) => {
      this.logger.warn(`Cache no disponible: ${error.message}`);
    });
  }

  /**
   * Comprobacion de vida de Redis para el readiness.
   *
   * A diferencia de obtener/guardar, esta SI propaga el error: el readiness
   * necesita enterarse de que Redis no responde, que es justamente lo que
   * tiene que reportar.
   */
  async ping(): Promise<void> {
    if (!this.cliente) {
      throw new Error('REDIS_URL no configurada');
    }
    await this.cliente.ping();
  }

  async obtener<T>(clave: string): Promise<T | null> {
    if (!this.cliente) {
      return null;
    }
    try {
      const crudo = await this.cliente.get(clave);
      return crudo ? (JSON.parse(crudo) as T) : null;
    } catch (error) {
      this.logger.warn(
        `Lectura de cache fallida (${clave}): ${(error as Error).message}`,
      );
      return null;
    }
  }

  async guardar(
    clave: string,
    valor: unknown,
    ttlSegundos: number,
  ): Promise<void> {
    if (!this.cliente) {
      return;
    }
    try {
      await this.cliente.set(clave, JSON.stringify(valor), 'EX', ttlSegundos);
    } catch (error) {
      this.logger.warn(
        `Escritura de cache fallida (${clave}): ${(error as Error).message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.cliente?.quit().catch(() => undefined);
  }
}
