import { Module } from '@nestjs/common';
import { JwtAuthModule } from '@turnos-platform/auth';
import { ConfiguracionController } from './configuracion.controller';
import { ConfiguracionService } from './configuracion.service';
import { HorarioService } from './horario.service';
import { ValidadorProveedores } from './validador-proveedores.service';

@Module({
  imports: [JwtAuthModule],
  controllers: [ConfiguracionController],
  providers: [ConfiguracionService, HorarioService, ValidadorProveedores],
  // Horario: lo leen la reserva, las sugerencias y el panel de carga.
  exports: [HorarioService],
})
export class ConfiguracionModule {}
