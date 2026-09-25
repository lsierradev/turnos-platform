import { Module } from '@nestjs/common';
import { JwtAuthModule } from '@turnos-platform/auth';
import { VehiculosController } from './vehiculos.controller';
import { VehiculosService } from './vehiculos.service';

@Module({
  imports: [JwtAuthModule],
  controllers: [VehiculosController],
  providers: [VehiculosService],
  // La reserva valida el vehiculo del turno; la recepcion actualiza el km.
  exports: [VehiculosService],
})
export class VehiculosModule {}
