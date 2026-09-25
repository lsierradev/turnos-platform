import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthModule } from '@turnos-platform/auth';
import { Bahia } from '../../entities/bahia.entity';
import { Turno } from '../../entities/turno.entity';
import { ConfiguracionModule } from '../configuracion/configuracion.module';
import { PoliticaModule } from '../politica/politica.module';
import { ServiciosModule } from '../servicios/servicios.module';
import { VehiculosModule } from '../vehiculos/vehiculos.module';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Turno, Bahia]),
    ServiciosModule,
    ConfiguracionModule,
    PoliticaModule,
    VehiculosModule,
    JwtAuthModule,
  ],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
})
export class AppointmentsModule {}
