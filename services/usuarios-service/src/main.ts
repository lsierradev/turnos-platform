import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import {
  HttpExceptionFilter,
  opcionesCors,
  saltosDeProxy,
} from '@turnos-platform/http';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // IP real de quien acepta un documento legal (Sprint 23), no la del
  // balanceador. Ver saltosDeProxy.
  app.set('trust proxy', saltosDeProxy());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Formato de error unico para toda la API, con requestId para poder
  // cruzar un reporte del beta con una linea de log concreta.
  app.useGlobalFilters(new HttpExceptionFilter());
  // admin-web vive en otro origen que las APIs: sin CORS el navegador
  // bloquea todas las llamadas antes de que salgan.
  app.enableCors(opcionesCors());
  await app.listen(process.env.PORT ?? 3002);
}
bootstrap();
