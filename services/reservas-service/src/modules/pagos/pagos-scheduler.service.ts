import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PagosService } from './pagos.service';

/**
 * Tareas periodicas de pagos (Sprint 24). Con dos replicas corren en las
 * dos: es seguro porque cada paso es condicional en la base (UPDATE ...
 * WHERE estado = ..., eventos idempotentes). Lo peor es una consulta
 * repetida a Wompi.
 */
@Injectable()
export class PagosSchedulerService {
  private readonly logger = new Logger(PagosSchedulerService.name);
  private enCurso = false;

  constructor(private readonly pagos: PagosService) {}

  /** Cada minuto: los turnos cuyo anticipo vencio sin pagarse se liberan. */
  @Cron('* * * * *')
  async liberarAnticiposVencidos(): Promise<void> {
    await this.unaALaVez(() => this.pagos.liberarVencidos());
  }

  /**
   * Cada 10 minutos: se le pregunta a Wompi por lo que quedo sin estado
   * final. Cubre eventos que no llegaron (el webhook caido, una URL mal
   * configurada) y anulaciones por pedir o sin confirmar.
   */
  @Cron('*/10 * * * *')
  async conciliar(): Promise<void> {
    await this.unaALaVez(async () => {
      const r = await this.pagos.conciliar();
      if (r.revisados || r.expirados) {
        this.logger.log(
          `Conciliacion: ${r.revisados} revisados, ${r.expirados} checkouts expirados`,
        );
      }
    });
  }

  /** Una corrida lenta (Wompi lento) no se pisa con la siguiente. */
  private async unaALaVez(fn: () => Promise<unknown>): Promise<void> {
    if (this.enCurso) return;
    this.enCurso = true;
    try {
      await fn();
    } catch (error) {
      this.logger.error(`Tarea de pagos fallo: ${(error as Error).message}`);
    } finally {
      this.enCurso = false;
    }
  }
}
