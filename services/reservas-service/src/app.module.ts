import { Module } from '@nestjs/common';
import { ReservasModule } from './modules/reservas/reservas.module';

@Module({
  imports: [ReservasModule],
})
export class AppModule {}
