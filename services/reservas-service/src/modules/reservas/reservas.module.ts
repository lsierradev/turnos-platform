import { Module } from '@nestjs/common';
import { ReservasController } from './reservas.controller';
import { ReservasService } from './reservas.service';

// Sin imports: RedisCacheModule es @Global, asi que RedisCacheService --de
// donde sale el ping de Redis del readiness-- se inyecta sin declararlo.
//
// Antes este modulo registraba la cola de Bull por segunda vez (
// NotificationsModule ya la registra) solo para poder hacer ese ping. Eso
// crea un segundo proveedor para el mismo nombre de cola, y de ahi a que el
// @Processor quede atado a la instancia equivocada hay un paso: el readiness
// no justifica ese riesgo.
@Module({
  controllers: [ReservasController],
  providers: [ReservasService],
})
export class ReservasModule {}
