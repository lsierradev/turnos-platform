import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { HttpExceptionFilter, opcionesCors } from '@turnos-platform/http';
import { AppModule } from './app.module';
import { zonaHorariaNegocio } from './common/zona-horaria.util';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Las fotos de la recepcion (Sprint 22) llegan en base64 dentro del JSON:
  // hasta 2 MB de imagen son ~2,7 MB de texto. El default de Express (100
  // kB) las rechazaba todas.
  app.useBodyParser('json', { limit: '4mb' });
  // Despues de create(): ConfigModule ya volco el .env en process.env. Asi
  // una TZ_NEGOCIO invalida tumba el arranque en vez del primer
  // POST /appointments.
  Logger.log(`Zona horaria de negocio: ${zonaHorariaNegocio()}`, 'Bootstrap');
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
