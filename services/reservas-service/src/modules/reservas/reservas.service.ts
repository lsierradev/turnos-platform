import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RedisCacheService } from '../../common/redis-cache.service';

export interface EstadoDependencia {
  status: 'up' | 'down';
  error?: string;
}

export interface Readiness {
  status: 'ok' | 'degraded';
  module: string;
  dependencias: Record<string, EstadoDependencia>;
}

// Un probe que tarda mas que esto ya es una dependencia caida a efectos
// practicos: no tiene sentido que el chequeo de salud herede el timeout
// largo de una consulta normal y deje al orquestador esperando.
const TIMEOUT_PROBE_MS = 2_000;

async function conTimeout<T>(promesa: Promise<T>): Promise<T> {
  let temporizador: NodeJS.Timeout;
  const limite = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(
      () => rechazar(new Error(`timeout de ${TIMEOUT_PROBE_MS}ms`)),
      TIMEOUT_PROBE_MS,
    );
  });
  try {
    return await Promise.race([promesa, limite]);
  } finally {
    clearTimeout(temporizador!);
  }
}

async function probar(fn: () => Promise<unknown>): Promise<EstadoDependencia> {
  try {
    await conTimeout(fn());
    return { status: 'up' };
  } catch (error) {
    return {
      status: 'down',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

@Injectable()
export class ReservasService {
  private readonly logger = new Logger(ReservasService.name);

  // Se usa el cliente de RedisCacheService y NO la cola de Bull. Registrar
  // la cola por segunda vez aca (NotificationsModule ya la registra) crea un
  // segundo proveedor para el mismo nombre, y de ahi a que el @Processor
  // quede atado a la instancia equivocada hay un paso. El readiness solo
  // necesita saber si Redis responde: un PING alcanza, y esa conexion ya
  // existe.
  constructor(
    private readonly dataSource: DataSource,
    private readonly cache: RedisCacheService,
  ) {}

  /**
   * Liveness: el proceso esta vivo y responde. A proposito NO toca ninguna
   * dependencia -- si lo hiciera, una caida momentanea de Postgres haria que
   * Kubernetes matara y reiniciara pods sanos, que es justo lo contrario de
   * lo que conviene durante un incidente de base de datos.
   */
  health() {
    return { status: 'ok', module: 'reservas' };
  }

  /**
   * Readiness: ademas, las dependencias responden.
   *
   * Hasta Sprint 9 solo existia health(), devolviendo 'ok' constante: un pod
   * con la base caida se declaraba sano, el balanceador le seguia mandando
   * trafico y nada lo sacaba de rotacion. Es el peor modo de falla posible
   * para el SLA -- el sistema caido y el monitoreo diciendo que esta bien.
   */
  async readiness(): Promise<Readiness> {
    const [postgres, redis] = await Promise.all([
      probar(() => this.dataSource.query('SELECT 1')),
      probar(() => this.cache.ping()),
    ]);

    const dependencias = { postgres, redis };
    const alguna = Object.values(dependencias).some((d) => d.status === 'down');

    if (alguna) {
      this.logger.warn(`Readiness degradado: ${JSON.stringify(dependencias)}`);
    }

    return {
      status: alguna ? 'degraded' : 'ok',
      module: 'reservas',
      dependencias,
    };
  }
}
