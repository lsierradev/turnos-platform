import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
  AnularStrikeDto,
  PoliticaDto,
  PoliticaQueryDto,
  ReclamoDto,
  ResolverReclamoDto,
  StrikesQueryDto,
} from './dto/politica.dto';
import { PoliticaService } from './politica.service';

/**
 * Politica de cancelacion del taller de la sesion (Sprint 22). La lee
 * cualquiera que opere en el taller: el cliente la ve antes de reservar y
 * de cancelar, con sus strikes vigentes ahi.
 */
@Controller('politica')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PoliticaController {
  constructor(private readonly politica: PoliticaService) {}

  @Get()
  obtener(@Query() query: PoliticaQueryDto, @CurrentUser() user: JwtPayload) {
    if (query.clienteId && query.clienteId !== user.sub) {
      // Reservar a nombre de un cliente es de admin (Sprint 17).
      if (user.rol !== Rol.ADMIN && user.rol !== Rol.SUPERADMIN) {
        throw new ForbiddenException(
          'Solo un administrador consulta los strikes de otro cliente.',
        );
      }
      return this.politica.paraCliente(query.clienteId);
    }
    return this.politica.paraCliente(user.sub);
  }

  @Put()
  @Roles(Rol.ADMIN)
  actualizar(@Body() dto: PoliticaDto) {
    return this.politica.actualizar(dto);
  }
}

@Controller('strikes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StrikesController {
  constructor(private readonly politica: PoliticaService) {}

  /** Los propios, de todos los talleres (perfil del cliente). */
  @Get('mios')
  mios(@CurrentUser() user: JwtPayload) {
    return this.politica.misStrikes(user.sub);
  }

  @Post(':id/reclamo')
  @Roles(Rol.CLIENTE)
  reclamar(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReclamoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.politica.reclamar(id, dto.texto, user.sub);
  }

  @Get()
  @Roles(Rol.ADMIN)
  listar(@Query() query: StrikesQueryDto) {
    return this.politica.listarTaller(query);
  }

  @Post(':id/anular')
  @Roles(Rol.ADMIN)
  anular(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AnularStrikeDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.politica.anular(id, dto, user.sub);
  }

  @Post(':id/reclamo/resolver')
  @Roles(Rol.ADMIN)
  resolverReclamo(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ResolverReclamoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.politica.resolverReclamo(id, dto, user.sub);
  }
}
