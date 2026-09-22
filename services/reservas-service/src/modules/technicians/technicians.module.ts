import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthModule } from '@turnos-platform/auth';
import { Turno } from '../../entities/turno.entity';
import { TechniciansController } from './technicians.controller';
import { TechniciansService } from './technicians.service';

@Module({
  imports: [TypeOrmModule.forFeature([Turno]), JwtAuthModule],
  controllers: [TechniciansController],
  providers: [TechniciansService],
})
export class TechniciansModule {}
