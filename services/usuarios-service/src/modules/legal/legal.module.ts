import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthModule } from '@turnos-platform/auth';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { LegalController, TitularController } from './legal.controller';
import { LegalService } from './legal.service';
import { TitularService } from './titular.service';

@Module({
  imports: [TypeOrmModule.forFeature([Usuario]), JwtAuthModule],
  controllers: [LegalController, TitularController],
  providers: [LegalService, TitularService],
  exports: [LegalService],
})
export class LegalModule {}
