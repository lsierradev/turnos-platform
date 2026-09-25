import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  CurrentUser,
  JwtAuthGuard,
  JwtPayload,
  Rol,
  Roles,
  RolesGuard,
} from '@turnos-platform/auth';
import {
  AceptarRecepcionDto,
  FotoDto,
  RecepcionDto,
} from './dto/recepcion.dto';
import { RecepcionesService } from './recepciones.service';

/**
 * Orden de trabajo y recepcion colgadas del turno (Sprint 22). La ve el
 * personal del taller y el titular del turno; la recepcion la carga el
 * personal.
 */
@Controller('appointments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdenTrabajoController {
  constructor(private readonly recepciones: RecepcionesService) {}

  @Get(':id/orden')
  orden(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.recepciones.orden(id, user);
  }

  @Put(':id/recepcion')
  @Roles(Rol.ADMIN, Rol.TECNICO)
  guardarRecepcion(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RecepcionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.recepciones.guardar(id, dto, user);
  }
}

@Controller('recepciones')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RecepcionesController {
  constructor(private readonly recepciones: RecepcionesService) {}

  @Post(':id/fotos')
  @Roles(Rol.ADMIN, Rol.TECNICO)
  agregarFoto(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: FotoDto,
  ) {
    return this.recepciones.agregarFoto(id, dto);
  }

  @Delete(':id/fotos/:fotoId')
  @Roles(Rol.ADMIN, Rol.TECNICO)
  @HttpCode(HttpStatus.NO_CONTENT)
  quitarFoto(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('fotoId', new ParseUUIDPipe()) fotoId: string,
  ) {
    return this.recepciones.quitarFoto(id, fotoId);
  }

  // Binario, no JSON: el navegador la pide con fetch (lleva el token) y
  // la muestra con un object URL.
  @Get(':id/fotos/:fotoId')
  async foto(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('fotoId', new ParseUUIDPipe()) fotoId: string,
  ) {
    const { tipoMime, datos } = await this.recepciones.foto(id, fotoId);
    return new StreamableFile(datos, {
      type: tipoMime,
      // Privada: tiene el token del usuario detras.
      disposition: 'inline',
    });
  }

  @Post(':id/aceptar')
  aceptar(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AceptarRecepcionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.recepciones.aceptar(id, dto, user);
  }
}
