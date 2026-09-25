import { Module } from '@nestjs/common';
import { JwtAuthModule } from '@turnos-platform/auth';
import { PoliticaController, StrikesController } from './politica.controller';
import { PoliticaService } from './politica.service';

@Module({
  imports: [JwtAuthModule],
  controllers: [PoliticaController, StrikesController],
  providers: [PoliticaService],
  // Cancelar, reprogramar y cerrar un turno suman strikes; reservar mira
  // cuantos tiene el cliente.
  exports: [PoliticaService],
})
export class PoliticaModule {}
