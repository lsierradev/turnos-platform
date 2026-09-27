import { Module } from '@nestjs/common';
import { JwtAuthModule } from '@turnos-platform/auth';
import { PagosController, WompiEventosController } from './pagos.controller';
import { PagosSchedulerService } from './pagos-scheduler.service';
import { PagosService } from './pagos.service';
import { WompiCliente } from './wompi-cliente.service';

@Module({
  imports: [JwtAuthModule],
  controllers: [PagosController, WompiEventosController],
  providers: [PagosService, WompiCliente, PagosSchedulerService],
  // Cancelar y reprogramar un turno mueven sus pagos (appointments).
  exports: [PagosService],
})
export class PagosModule {}
