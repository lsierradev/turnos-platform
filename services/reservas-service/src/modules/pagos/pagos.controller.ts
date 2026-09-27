import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
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
import { ContextoDb } from '@turnos-platform/tenant';
import type { Request } from 'express';
import {
  CajaQueryDto,
  CheckoutDto,
  CierreCajaDto,
  CompletarReembolsoDto,
  DisputaDto,
  FiltroQueryDto,
  PagoPresencialDto,
  ReferenciaParamDto,
  ResolverDisputaDto,
  TurnoPagosQueryDto,
} from './dto/pagos.dto';
import { PagosService } from './pagos.service';
import type { EventoWompi } from './wompi.util';

/** Pagos (Sprint 24). */
@Controller('pagos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PagosController {
  constructor(
    private readonly pagos: PagosService,
    private readonly db: ContextoDb,
  ) {}

  /** Checkout de Wompi del cliente: devuelve la URL firmada. */
  @Post('checkout')
  @Roles(Rol.CLIENTE)
  checkout(@Body() dto: CheckoutDto, @CurrentUser() user: JwtPayload) {
    return this.pagos.checkout(dto.turnoId, dto.concepto, {
      sub: user.sub,
      email: user.email,
    });
  }

  /** La pantalla de vuelta del checkout (estado desde el servidor). */
  @Get('referencia/:referencia')
  @Roles(Rol.CLIENTE)
  porReferencia(
    @Param() { referencia }: ReferenciaParamDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.pagos.estadoPorReferencia(referencia, user.sub);
  }

  /** Pagos de un turno: el titular o el personal del taller (RLS). */
  @Get('turno')
  deTurno(@Query() { turnoId }: TurnoPagosQueryDto) {
    return this.pagos.detalleTurno(turnoId);
  }

  @Post('presencial')
  @Roles(Rol.ADMIN)
  presencial(@Body() dto: PagoPresencialDto, @CurrentUser() user: JwtPayload) {
    return this.pagos.registrarPresencial(dto, user.sub);
  }

  @Get('reembolsos')
  @Roles(Rol.ADMIN)
  reembolsos(@Query() { estado }: FiltroQueryDto) {
    return this.pagos.reembolsos(estado !== 'todos');
  }

  @Post('reembolsos/:id/completar')
  @Roles(Rol.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  completarReembolso(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() { nota }: CompletarReembolsoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.pagos.completarReembolso(id, nota, user.sub);
  }

  @Post(':id/disputa')
  @Roles(Rol.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  disputa(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DisputaDto,
  ) {
    return this.pagos.abrirDisputa(id, dto.tipo, dto.detalle);
  }

  @Post(':id/disputa/resolver')
  @Roles(Rol.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  resolverDisputa(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() { resultado }: ResolverDisputaDto,
  ) {
    return this.pagos.resolverDisputa(id, resultado);
  }

  @Get('alertas')
  @Roles(Rol.ADMIN)
  alertas(@Query() { estado }: FiltroQueryDto) {
    return this.pagos.alertas(estado !== 'todos');
  }

  @Post('alertas/:id/atender')
  @Roles(Rol.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  atender(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.pagos.atenderAlerta(id, user.sub);
  }

  @Get('caja')
  @Roles(Rol.ADMIN)
  caja(@Query() { fecha }: CajaQueryDto) {
    return this.pagos.caja(fecha);
  }

  @Post('caja/cierre')
  @Roles(Rol.ADMIN)
  cerrarCaja(@Body() dto: CierreCajaDto, @CurrentUser() user: JwtPayload) {
    return this.pagos.cerrarCaja(
      dto.fecha,
      dto.contadoCentavos,
      dto.nota,
      user.sub,
    );
  }

  /**
   * La URL de eventos que el admin pega en el panel de Wompi. RESERVAS_URL_
   * PUBLICA es la direccion con la que Wompi llega a este servicio (por
   * internet, HTTPS); sin ella se arma con la del request.
   */
  @Get('wompi/url-eventos')
  @Roles(Rol.ADMIN)
  urlEventos(@Req() req: Request) {
    const base =
      process.env.RESERVAS_URL_PUBLICA ??
      `${req.protocol}://${req.get('host') ?? 'localhost:3001'}`;
    return { url: this.pagos.urlEventos(this.db.exigirTaller(), base) };
  }
}

/**
 * Webhook de Wompi: publico (Wompi no manda token). Una URL por taller,
 * porque cada taller firma con SU secreto de eventos. Responde 200 a todo
 * evento autentico (aunque no aplique), para que Wompi no lo reintente, y
 * 401 si la firma no cierra.
 */
@Controller('pagos/wompi/eventos')
export class WompiEventosController {
  constructor(private readonly pagos: PagosService) {}

  @Post(':tallerId')
  @HttpCode(HttpStatus.OK)
  recibir(
    @Param('tallerId', new ParseUUIDPipe()) tallerId: string,
    @Body() evento: EventoWompi,
    @Headers('x-event-checksum') checksum?: string,
  ) {
    return this.pagos.procesarEvento(tallerId, evento, checksum);
  }
}
