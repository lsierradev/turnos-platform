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
import { JwtAuthGuard } from '@turnos-platform/auth';
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
@UseGuards(JwtAuthGuard)
export class ServiciosController {
  constructor(private readonly serviciosService: ServiciosService) {}

  @Post()
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
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateServicioDto,
  ) {
    return this.serviciosService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.serviciosService.remove(id);
  }
}
