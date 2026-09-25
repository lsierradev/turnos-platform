import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContextoDb } from '@turnos-platform/tenant';
import { DataSource, QueryFailedError } from 'typeorm';
import { ActualizarVehiculoDto, VehiculoDto } from './dto/vehiculo.dto';

export interface Vehiculo {
  id: string;
  usuarioId: string;
  placa: string;
  marca: string;
  modelo: string;
  anio: number;
  kilometraje: number;
  activo: boolean;
}

const COLUMNAS = `id, usuario_id AS "usuarioId", placa, marca, modelo,
                  anio, kilometraje, activo`;

/** "abc 12-3" -> "ABC123". */
export function normalizarPlaca(placa: string): string {
  return placa.toUpperCase().replace(/[\s-]/g, '');
}

function validarPlaca(placa: string): string {
  const normalizada = normalizarPlaca(placa);
  if (!/^[A-Z0-9]{5,7}$/.test(normalizada)) {
    throw new BadRequestException(
      `La placa ${placa} no es valida (por ejemplo ABC123 o ABC12D).`,
    );
  }
  return normalizada;
}

function validarAnio(anio: number): void {
  // Modelo del ano siguiente: se venden desde mitad de ano.
  const maximo = new Date().getUTCFullYear() + 1;
  if (anio > maximo) {
    throw new BadRequestException(`El ano no puede ser posterior a ${maximo}.`);
  }
}

function esPlacaRepetida(error: unknown): boolean {
  const codigo = (error as { driverError?: { code?: string } }).driverError
    ?.code;
  return error instanceof QueryFailedError && codigo === '23505';
}

/**
 * Vehiculos del cliente (Sprint 22). Son del cliente, no del taller: el
 * mismo carro va a cualquier taller. RLS (017) deja ver los propios y, al
 * personal, los de los clientes del taller.
 */
@Injectable()
export class VehiculosService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly db: ContextoDb,
  ) {}

  private consultar<T>(sql: string, params: unknown[]): Promise<T> {
    return this.db.query(sql, params, this.dataSource) as Promise<T>;
  }

  /**
   * De quien son los vehiculos que se piden o cargan. El cliente: los
   * suyos, siempre (un clienteId ajeno es 403 en el controller). El
   * personal: los de un cliente DEL TALLER.
   */
  async titular(
    usuario: { sub: string; rol: string },
    clienteId?: string,
  ): Promise<string> {
    if (usuario.rol === 'cliente') return usuario.sub;
    if (!clienteId) {
      throw new BadRequestException('Indica de que cliente (clienteId).');
    }
    const taller = this.db.exigirTaller();
    const filas = await this.consultar<unknown[]>(
      'SELECT 1 FROM clientes_taller WHERE taller_id = $1 AND usuario_id = $2',
      [taller, clienteId],
    );
    if (!filas.length) {
      throw new NotFoundException(
        `Cliente ${clienteId} no encontrado en este taller`,
      );
    }
    return clienteId;
  }

  listar(usuarioId: string): Promise<Vehiculo[]> {
    return this.consultar<Vehiculo[]>(
      `SELECT ${COLUMNAS} FROM vehiculos
        WHERE usuario_id = $1 AND activo
        ORDER BY creado_en`,
      [usuarioId],
    );
  }

  /** Uno visible para la sesion (RLS), activo o no. */
  async obtener(id: string): Promise<Vehiculo> {
    const [fila] = await this.consultar<Vehiculo[]>(
      `SELECT ${COLUMNAS} FROM vehiculos WHERE id = $1`,
      [id],
    );
    if (!fila) throw new NotFoundException(`Vehiculo ${id} no encontrado`);
    return fila;
  }

  async crear(dto: VehiculoDto, usuarioId: string): Promise<Vehiculo> {
    const placa = validarPlaca(dto.placa);
    validarAnio(dto.anio);
    try {
      const [fila] = await this.db.conSavepoint(() =>
        this.consultar<Vehiculo[]>(
          `INSERT INTO vehiculos (usuario_id, placa, marca, modelo, anio, kilometraje)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING ${COLUMNAS}`,
          [
            usuarioId,
            placa,
            dto.marca.trim(),
            dto.modelo.trim(),
            dto.anio,
            dto.kilometraje,
          ],
        ),
      );
      return fila;
    } catch (error) {
      if (esPlacaRepetida(error)) {
        throw new ConflictException(
          `Ya hay un vehiculo con la placa ${placa}.`,
        );
      }
      throw error;
    }
  }

  async actualizar(id: string, dto: ActualizarVehiculoDto): Promise<Vehiculo> {
    const actual = await this.obtener(id);
    if (!actual.activo) {
      throw new BadRequestException('Ese vehiculo esta dado de baja.');
    }
    if (dto.anio !== undefined) validarAnio(dto.anio);
    const placa =
      dto.placa !== undefined ? validarPlaca(dto.placa) : actual.placa;
    try {
      const [fila] = await this.db.conSavepoint(() =>
        this.consultar<Vehiculo[][]>(
          `UPDATE vehiculos
              SET placa = $2, marca = $3, modelo = $4, anio = $5,
                  kilometraje = $6, actualizado_en = now()
            WHERE id = $1
          RETURNING ${COLUMNAS}`,
          [
            id,
            placa,
            dto.marca?.trim() ?? actual.marca,
            dto.modelo?.trim() ?? actual.modelo,
            dto.anio ?? actual.anio,
            dto.kilometraje ?? actual.kilometraje,
          ],
        ),
      );
      // UPDATE ... RETURNING via query(): [filas, cantidad].
      return fila[0];
    } catch (error) {
      if (esPlacaRepetida(error)) {
        throw new ConflictException(
          `Ya hay un vehiculo con la placa ${placa}.`,
        );
      }
      throw error;
    }
  }

  /** Baja logica: turnos y recepciones pasados lo siguen nombrando. */
  async baja(id: string): Promise<void> {
    await this.obtener(id);
    await this.consultar(
      'UPDATE vehiculos SET activo = false, actualizado_en = now() WHERE id = $1',
      [id],
    );
  }

  /** La recepcion trae el kilometraje real; nunca lo baja. */
  async registrarKilometraje(id: string, kilometraje: number): Promise<void> {
    await this.consultar(
      `UPDATE vehiculos SET kilometraje = $2, actualizado_en = now()
        WHERE id = $1 AND kilometraje < $2`,
      [id, kilometraje],
    );
  }
}
