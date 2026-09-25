import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantModule } from '@turnos-platform/tenant';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { RedisCacheModule } from './common/redis-cache.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { BahiasModule } from './modules/bahias/bahias.module';
import { ConfiguracionModule } from './modules/configuracion/configuracion.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PoliticaModule } from './modules/politica/politica.module';
import { RecepcionesModule } from './modules/recepciones/recepciones.module';
import { ReservasModule } from './modules/reservas/reservas.module';
import { ServiciosModule } from './modules/servicios/servicios.module';
import { TechniciansModule } from './modules/technicians/technicians.module';
import { VehiculosModule } from './modules/vehiculos/vehiculos.module';

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
        // Espacio de nombres de las colas en Redis. 'bull' es el default de
        // Bull (lo que se uso siempre). Los tests de integracion ponen uno
        // propio por corrida: si no, un reservas-service corriendo en la
        // misma maquina (mismo Redis) consume los jobs del test con sus
        // providers reales. Paso en Sprint 16: el job del test termino
        // "fallido" con "SENDGRID_API_KEY no configurada" del proceso de dev.
        prefix: config.get<string>('BULL_PREFIX') || 'bull',
      }),
    }),
    // Contexto de taller + RLS por request (Sprint 20).
    TenantModule.conDataSource(DataSource),
    ScheduleModule.forRoot(),
    RedisCacheModule,
    ReservasModule,
    ServiciosModule,
    AppointmentsModule,
    TechniciansModule,
    NotificationsModule,
    DashboardModule,
    BahiasModule,
    ConfiguracionModule,
    // Sprint 22: politica de cancelacion, vehiculos y recepcion.
    PoliticaModule,
    VehiculosModule,
    RecepcionesModule,
  ],
})
export class AppModule {}
