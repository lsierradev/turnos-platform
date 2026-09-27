import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, JwtAuthGuard, JwtPayload, Rol, Roles, RolesGuard } from '@turnos-platform/auth';
import {
  ActualizarLineaDto,
  AgregarLineaRepuestoDto,
  AgregarLineaServicioDto,
  AnularOrdenDto,
  CrearOrdenDto,
  MarcarPagadaDto,
  OrdenesQueryDto,
} from './dto/ventas.dto';
import { VentasService } from './ventas.service';

/**
 * Orden de venta (Sprint 26): el admin la arma y la gestiona; el cliente
 * solo ve la suya y acepta la cotizacion (RLS limita el resto, esto ademas
 * da un mensaje claro en vez de un 403 crudo en cada ruta de escritura).
 */
@Controller('ventas')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VentasController {
  constructor(private readonly ventas: VentasService) {}

  @Get()
  @Roles(Rol.ADMIN)
  listar(@Query() query: OrdenesQueryDto) {
    return this.ventas.listar(query);
  }

  @Get(':id')
  @Roles(Rol.ADMIN, Rol.CLIENTE)
  obtener(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.ventas.obtener(id);
  }

  @Post()
  @Roles(Rol.ADMIN)
  crear(@Body() dto: CrearOrdenDto, @CurrentUser() user: JwtPayload) {
    return this.ventas.crear(dto, { sub: user.sub, rol: user.rol });
  }

  @Post(':id/lineas/servicio')
  @Roles(Rol.ADMIN)
  agregarLineaServicio(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AgregarLineaServicioDto,
  ) {
    return this.ventas.agregarLineaServicio(id, dto);
  }

  @Post(':id/lineas/repuesto')
  @Roles(Rol.ADMIN)
  agregarLineaRepuesto(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AgregarLineaRepuestoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ventas.agregarLineaRepuesto(id, dto, { sub: user.sub, rol: user.rol });
  }

  @Patch(':id/lineas/:lineaId')
  @Roles(Rol.ADMIN)
  actualizarLinea(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('lineaId', new ParseUUIDPipe()) lineaId: string,
    @Body() dto: ActualizarLineaDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ventas.actualizarLinea(id, lineaId, dto, { sub: user.sub, rol: user.rol });
  }

  @Delete(':id/lineas/:lineaId')
  @Roles(Rol.ADMIN)
  borrarLinea(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('lineaId', new ParseUUIDPipe()) lineaId: string,
  ) {
    return this.ventas.borrarLinea(id, lineaId);
  }

  @Delete(':id')
  @Roles(Rol.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  borrar(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.ventas.borrar(id);
  }

  @Post(':id/confirmar')
  @Roles(Rol.ADMIN)
  confirmar(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: JwtPayload) {
    return this.ventas.confirmar(id, { sub: user.sub, rol: user.rol });
  }

  @Post(':id/pagar')
  @Roles(Rol.ADMIN)
  marcarPagada(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: MarcarPagadaDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ventas.marcarPagada(id, dto, { sub: user.sub, rol: user.rol });
  }

  @Post(':id/anular')
  @Roles(Rol.ADMIN)
  anular(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AnularOrdenDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ventas.anular(id, dto, { sub: user.sub, rol: user.rol });
  }

  @Post(':id/cotizacion/enviar')
  @Roles(Rol.ADMIN)
  enviarCotizacion(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.ventas.enviarCotizacion(id);
  }

  /** El cliente la acepta desde su cuenta (RLS + SECURITY DEFINER, ver migracion 021). */
  @Post(':id/cotizacion/aceptar')
  @Roles(Rol.CLIENTE)
  aceptarCotizacion(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.ventas.aceptarCotizacion(id);
  }
}
