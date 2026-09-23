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
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, Rol, Roles, RolesGuard } from '@turnos-platform/auth';
import { CreateServicioDto } from './dto/create-servicio.dto';
import { UpdateServicioDto } from './dto/update-servicio.dto';
import { ServiciosService } from './servicios.service';

// El :id de estas tres rutas va directo a una columna UUID. Sin
// ParseUUIDPipe, un id con cualquier otra forma ("abc") llega hasta
// Postgres, que responde 22P02 invalid input syntax for type uuid: el
// cliente recibe un 500 opaco en vez del 400 que corresponde, y el error
// queda registrado como falla del servicio. Mismo pipe que ya usaban
// technicians.controller.ts y appointments.controller.ts.
@Controller('servicios')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ServiciosController {
  constructor(private readonly serviciosService: ServiciosService) {}

  // Escritura del catalogo: solo admin. La lectura (findAll/findOne) queda
  // abierta a cualquier autenticado porque el flujo de reserva necesita
  // listar servicios para poder elegir uno.
  @Post()
  @Roles(Rol.ADMIN)
  create(@Body() dto: CreateServicioDto) {
    return this.serviciosService.create(dto);
  }

  @Get()
  findAll() {
    return this.serviciosService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.serviciosService.findOne(id);
  }

  @Patch(':id')
  @Roles(Rol.ADMIN)
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateServicioDto,
  ) {
    return this.serviciosService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Rol.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.serviciosService.remove(id);
  }
}
