import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { DOCUMENTOS_PLATAFORMA, TIPOS_DOCUMENTO } from '../catalogo';
import type { DocumentoPlataforma, TipoDocumento } from '../catalogo';

export class AceptarDocumentoDto {
  @IsIn(TIPOS_DOCUMENTO)
  documento: TipoDocumento;

  /** La version que el usuario leyo: si ya no es la vigente, 409. */
  @IsInt()
  @Min(1)
  version: number;

  // 'presencial' no: esa la registra el personal por el cliente.
  @IsOptional()
  @IsIn(['web', 'app'])
  canal?: 'web' | 'app';
}

export class DocumentoParamDto {
  @IsIn(DOCUMENTOS_PLATAFORMA)
  tipo: DocumentoPlataforma;
}

export class VersionQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

export class PublicarCondicionesDto {
  @IsString()
  @MinLength(200, { message: 'Las condiciones son demasiado cortas.' })
  @MaxLength(60000)
  contenido: string;
}

export class BorradorQueryDto {
  /** 'plantilla': empezar de nuevo desde la plantilla de TurnoPro. */
  @IsOptional()
  @IsIn(['plantilla', 'publicada'])
  desde?: 'plantilla' | 'publicada';
}

export class EstadoCondicionesQueryDto {
  /** Admin: el cliente por el que reserva. Sin esto, uno mismo. */
  @IsOptional()
  @IsUUID()
  clienteId?: string;
}

export class AceptarPresencialDto {
  @IsUUID()
  clienteId: string;

  @IsIn(['condiciones_taller', 'politica_datos', 'autorizacion_datos'], {
    each: true,
  })
  documentos: TipoDocumento[];
}
