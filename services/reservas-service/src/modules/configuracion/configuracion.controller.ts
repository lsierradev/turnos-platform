import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, Rol, Roles, RolesGuard } from '@turnos-platform/auth';
import { ConfiguracionService } from './configuracion.service';
import {
  DatosFiscalesDto,
  FacturacionDto,
  FeriadoDto,
  FestivosColombiaDto,
  HorarioDto,
  WompiDto,
} from './dto/configuracion.dto';

/**
 * Configuracion del taller de la sesion (Sprint 21). Escribir: admin (el
 * superadmin pasa donde se pide admin). Leer el horario: cualquiera que
 * opere en el taller, porque la reserva muestra que dias atiende.
 */
@Controller('configuracion')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConfiguracionController {
  constructor(private readonly configuracion: ConfiguracionService) {}

  @Get('fiscal')
  @Roles(Rol.ADMIN)
  fiscal() {
    return this.configuracion.obtenerFiscal();
  }

  @Put('fiscal')
  @Roles(Rol.ADMIN)
  actualizarFiscal(@Body() dto: DatosFiscalesDto) {
    return this.configuracion.actualizarDatosFiscales(dto);
  }

  @Put('facturacion')
  @Roles(Rol.ADMIN)
  actualizarFacturacion(@Body() dto: FacturacionDto) {
    return this.configuracion.actualizarFacturacion(dto);
  }

  @Put('wompi')
  @Roles(Rol.ADMIN)
  actualizarWompi(@Body() dto: WompiDto) {
    return this.configuracion.actualizarWompi(dto);
  }

  @Get('horario')
  horario() {
    return this.configuracion.obtenerHorario();
  }

  @Put('horario')
  @Roles(Rol.ADMIN)
  actualizarHorario(@Body() dto: HorarioDto) {
    return this.configuracion.actualizarHorario(dto);
  }

  @Post('feriados')
  @Roles(Rol.ADMIN)
  agregarFeriado(@Body() dto: FeriadoDto) {
    return this.configuracion.agregarFeriado(dto);
  }

  @Post('feriados/colombia')
  @Roles(Rol.ADMIN)
  importarFestivos(@Body() dto: FestivosColombiaDto) {
    return this.configuracion.importarFestivosColombia(dto.anio);
  }

  @Delete('feriados/:fecha')
  @Roles(Rol.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  eliminarFeriado(@Param('fecha') fecha: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      throw new BadRequestException('fecha debe ser YYYY-MM-DD');
    }
    return this.configuracion.eliminarFeriado(fecha);
  }
}
