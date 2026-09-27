import { Module } from '@nestjs/common';
import { JwtAuthModule } from '@turnos-platform/auth';
import { ServiciosModule } from '../servicios/servicios.module';
import { InventarioController } from './inventario.controller';
import { InventarioService } from './inventario.service';

@Module({
  imports: [ServiciosModule, JwtAuthModule],
  controllers: [InventarioController],
  providers: [InventarioService],
})
export class InventarioModule {}
