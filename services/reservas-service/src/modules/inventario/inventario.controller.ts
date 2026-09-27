import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
  ActualizarItemDto,
  CrearItemDto,
  ItemsQueryDto,
  KardexQueryDto,
  RegistrarMovimientoDto,
} from './dto/inventario.dto';
import { InventarioService } from './inventario.service';

/**
 * Inventario de repuestos (Sprint 25): catalogo, movimientos (kardex),
 * valorizacion y alerta de stock bajo. Todo del taller de la sesion (RLS,
 * migracion 020); el catalogo y los reportes son del admin, el tecnico
 * solo lee el catalogo (para elegir un repuesto) y registra los que usa en
 * SUS turnos.
 */
@Controller('inventario')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InventarioController {
  constructor(private readonly inventario: InventarioService) {}

  @Get('items')
  @Roles(Rol.ADMIN, Rol.TECNICO)
  listar(@Query() { estado }: ItemsQueryDto) {
    return this.inventario.listar(estado !== 'todos');
  }

  @Post('items')
  @Roles(Rol.ADMIN)
  crear(@Body() dto: CrearItemDto) {
    return this.inventario.crear(dto);
  }

  @Patch('items/:id')
  @Roles(Rol.ADMIN)
  actualizar(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ActualizarItemDto,
  ) {
    return this.inventario.actualizar(id, dto);
  }

  @Post('movimientos')
  @Roles(Rol.ADMIN, Rol.TECNICO)
  registrarMovimiento(
    @Body() dto: RegistrarMovimientoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.inventario.registrarMovimiento(dto, {
      sub: user.sub,
      rol: user.rol,
    });
  }

  /** Kardex completo de un item, con el saldo despues de cada movimiento. */
  @Get('movimientos')
  @Roles(Rol.ADMIN)
  kardex(@Query() { itemId }: KardexQueryDto) {
    return this.inventario.kardex(itemId);
  }

  /** Repuestos usados en un turno (la seccion de la orden de trabajo). */
  @Get('movimientos/turno/:turnoId')
  @Roles(Rol.ADMIN, Rol.TECNICO)
  movimientosDeTurno(@Param('turnoId', new ParseUUIDPipe()) turnoId: string) {
    return this.inventario.movimientosDeTurno(turnoId);
  }

  @Get('valorizacion')
  @Roles(Rol.ADMIN)
  valorizacion() {
    return this.inventario.valorizacion();
  }

  @Get('alertas')
  @Roles(Rol.ADMIN)
  alertas() {
    return this.inventario.alertaStockBajo();
  }
}
