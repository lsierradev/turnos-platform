import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { ReservasModule } from './modules/reservas/reservas.module';
import { ServiciosModule } from './modules/servicios/servicios.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        entities: [join(__dirname, '**/*.entity{.ts,.js}')],
        synchronize: false,
      }),
    }),
    ReservasModule,
    ServiciosModule,
    AppointmentsModule,
  ],
})
export class AppModule {}
