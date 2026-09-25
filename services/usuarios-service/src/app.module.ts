import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantModule } from '@turnos-platform/tenant';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { AuthModule } from './modules/auth/auth.module';
import { TalleresModule } from './modules/talleres/talleres.module';
import { UsuariosModule } from './modules/usuarios/usuarios.module';

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
    // Contexto de taller + RLS por request (Sprint 20).
    TenantModule.conDataSource(DataSource),
    UsuariosModule,
    AuthModule,
    TalleresModule,
  ],
})
export class AppModule {}
