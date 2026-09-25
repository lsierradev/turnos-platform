import { PartialType } from '@nestjs/mapped-types';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class VehiculoDto {
  /** Con o sin espacios/guion ("ABC 123", "abc-12d"); se normaliza. */
  @IsString()
  @Matches(/^[A-Za-z0-9\s-]{5,10}$/, {
    message: 'La placa lleva letras y numeros (por ejemplo ABC123).',
  })
  placa: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  marca: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  modelo: string;

  // El tope superior lo valida el servicio (ano actual + 1).
  @IsInt()
  @Min(1950)
  anio: number;

  @IsInt()
  @Min(0)
  @Max(3_000_000)
  kilometraje: number;

  /** Solo personal del taller: a nombre de que cliente. */
  @IsOptional()
  @IsUUID()
  clienteId?: string;
}

export class ActualizarVehiculoDto extends PartialType(VehiculoDto) {}

export class VehiculosQueryDto {
  /** Personal del taller: los de ese cliente. El cliente ve los suyos. */
  @IsOptional()
  @IsUUID()
  clienteId?: string;
}
