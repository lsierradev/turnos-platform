import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
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
import { ContextoDb, Sesion } from '@turnos-platform/tenant';
import type { Request, Response } from 'express';
import {
  AceptarDocumentoDto,
  AceptarPresencialDto,
  BorradorQueryDto,
  DocumentoParamDto,
  EstadoCondicionesQueryDto,
  PublicarCondicionesDto,
  VersionQueryDto,
} from './dto/legal.dto';
import { RectificarDatosDto, SuprimirCuentaDto } from './dto/titular.dto';
import { LegalService } from './legal.service';
import { origenDe } from './origen.util';
import { TitularService } from './titular.service';

/** Documentos legales y aceptaciones (Sprint 23). */
@Controller('legal')
export class LegalController {
  constructor(
    private readonly legal: LegalService,
    private readonly db: ContextoDb,
  ) {}

  // Publicos: la politica y los terminos se leen antes de tener cuenta (y
  // desde el pie del login).
  @Get('documentos')
  documentos() {
    return this.legal.documentosVigentes();
  }

  @Get('documentos/:tipo')
  documento(
    @Param() { tipo }: DocumentoParamDto,
    @Query() { version }: VersionQueryDto,
  ) {
    return this.legal.documento(tipo, version);
  }

  @Get('talleres/:tallerId/condiciones')
  async condicionesDeTaller(
    @Param('tallerId', new ParseUUIDPipe()) tallerId: string,
    @Query() { version }: VersionQueryDto,
  ) {
    const condiciones = await this.legal.condicionesDeTaller(tallerId, version);
    if (!condiciones) {
      throw new NotFoundException(
        'Este taller todavia no publico sus condiciones.',
      );
    }
    return condiciones;
  }

  // -------------------------------------------------------- con sesion

  @Get('pendientes')
  @UseGuards(JwtAuthGuard)
  pendientes() {
    return this.legal.pendientes(this.sesion());
  }

  @Post('aceptaciones')
  @UseGuards(JwtAuthGuard)
  aceptar(@Body() dto: AceptarDocumentoDto, @Req() req: Request) {
    return this.legal.aceptar(
      this.sesion(),
      { ...dto, canal: dto.canal ?? 'web' },
      origenDe(req),
    );
  }

  @Get('aceptaciones/mias')
  @UseGuards(JwtAuthGuard)
  mias(@CurrentUser() user: JwtPayload) {
    return this.legal.mias(user.sub);
  }

  /** El admin deja constancia de lo que el cliente acepto en el mostrador. */
  @Post('aceptaciones/presenciales')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Rol.ADMIN)
  aceptarPresencial(@Body() dto: AceptarPresencialDto, @Req() req: Request) {
    return this.legal.aceptarPresencial(
      this.sesion(),
      dto.clienteId,
      dto.documentos,
      origenDe(req),
    );
  }

  // ------------------------------------------- condiciones del taller

  @Get('condiciones/borrador')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Rol.ADMIN)
  borrador(@Query() { desde }: BorradorQueryDto) {
    return this.legal.borradorCondiciones(desde === 'plantilla');
  }

  @Get('condiciones/versiones')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Rol.ADMIN)
  versiones() {
    return this.legal.versionesCondiciones();
  }

  @Post('condiciones')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Rol.ADMIN)
  publicar(@Body() { contenido }: PublicarCondicionesDto) {
    return this.legal.publicarCondiciones(this.sesion(), contenido);
  }

  /**
   * Las condiciones vigentes del taller de la sesion y si el cliente ya
   * las acepto (el formulario de reserva). Un cliente pregunta por si
   * mismo; el admin, por el cliente por el que reserva.
   */
  @Get('condiciones/estado')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Rol.ADMIN, Rol.CLIENTE)
  estado(
    @Query() { clienteId }: EstadoCondicionesQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const esAdmin = user.rol === Rol.ADMIN || user.rol === Rol.SUPERADMIN;
    return this.legal.estadoCondiciones(
      esAdmin && clienteId ? clienteId : user.sub,
    );
  }

  private sesion(): Sesion {
    // Siempre hay sesion detras de JwtAuthGuard: el interceptor la abre.
    return this.db.sesion()!;
  }
}

/** Derechos del titular (Sprint 23): consultar, rectificar, exportar, suprimir. */
@Controller('mis-datos')
@UseGuards(JwtAuthGuard)
export class TitularController {
  constructor(private readonly titular: TitularService) {}

  @Get()
  consultar(@CurrentUser() user: JwtPayload) {
    return this.titular.consultar(user.sub);
  }

  @Patch()
  rectificar(
    @CurrentUser() user: JwtPayload,
    @Body() dto: RectificarDatosDto,
    @Req() req: Request,
  ) {
    return this.titular.rectificar(user.sub, dto, origenDe(req));
  }

  @Get('exportar')
  async exportar(
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const datos = await this.titular.exportar(user.sub, origenDe(req));
    const fecha = datos.generadoEn.slice(0, 10);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="mis-datos-turnopro-${fecha}.json"`,
    );
    return datos;
  }

  @Post('suprimir')
  @HttpCode(HttpStatus.OK)
  suprimir(
    @CurrentUser() user: JwtPayload,
    @Body() { password }: SuprimirCuentaDto,
    @Req() req: Request,
  ) {
    return this.titular.suprimir(user.sub, password, origenDe(req));
  }
}
