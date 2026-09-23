import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { HttpExceptionFilter, opcionesCors } from '@turnos-platform/http';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Formato de error unico para toda la API, con requestId para poder
  // cruzar un reporte del beta con una linea de log concreta.
  app.useGlobalFilters(new HttpExceptionFilter());
  // admin-web vive en otro origen que las APIs: sin CORS el navegador
  // bloquea todas las llamadas antes de que salgan.
  app.enableCors(opcionesCors());
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
