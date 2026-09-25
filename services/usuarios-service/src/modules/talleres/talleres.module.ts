import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthModule } from '@turnos-platform/auth';
import { UsuariosModule } from '../usuarios/usuarios.module';
import { TalleresController } from './talleres.controller';
import { TalleresService } from './talleres.service';
import { Taller } from './taller.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Taller]), JwtAuthModule, UsuariosModule],
  controllers: [TalleresController],
  providers: [TalleresService],
})
export class TalleresModule {}
