import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ReservasModule } from './modules/reservas/reservas.module';
import { ServiciosModule } from './modules/servicios/servicios.module';
import { TechniciansModule } from './modules/technicians/technicians.module';

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
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        url: config.get<string>('REDIS_URL'),
      }),
    }),
    ScheduleModule.forRoot(),
    ReservasModule,
    ServiciosModule,
    AppointmentsModule,
    TechniciansModule,
    NotificationsModule,
  ],
})
export class AppModule {}
