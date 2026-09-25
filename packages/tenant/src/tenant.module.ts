import { DynamicModule, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ContextoDb, DATA_SOURCE_TENANT } from './contexto-db';
import { ContextoInterceptor } from './contexto.interceptor';

/**
 * Importar UNA vez en el AppModule, despues de TypeOrmModule:
 *
 *   TenantModule.conDataSource(DataSource)   // DataSource de 'typeorm' del servicio
 *
 * Deja ContextoDb disponible en toda la app y registra el interceptor
 * global que abre la transaccion con RLS de cada request. Se pasa la clase
 * DataSource del propio servicio porque la copia de typeorm de este paquete
 * es otra (ver contexto-db.ts).
 */
@Module({})
export class TenantModule {
  static conDataSource(dataSourceToken: unknown): DynamicModule {
    return {
      module: TenantModule,
      global: true,
      providers: [
        { provide: DATA_SOURCE_TENANT, useExisting: dataSourceToken as string },
        ContextoDb,
        { provide: APP_INTERCEPTOR, useClass: ContextoInterceptor },
      ],
      exports: [ContextoDb],
    };
  }
}
