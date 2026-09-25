import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { decrypt } from '@turnos-platform/crypto';
import { ContextoDb } from '@turnos-platform/tenant';
import { DataSource } from 'typeorm';
import { zonaHorariaNegocio } from '../../common/zona-horaria.util';
import { CorreosService } from '../notifications/correos.service';
import { VehiculosService } from '../vehiculos/vehiculos.service';
import {
  AceptarRecepcionDto,
  FotoDto,
  RecepcionDto,
  type TipoFoto,
} from './dto/recepcion.dto';
import {
  OrdenTrabajo,
  textoConstancia,
  textoGarantia,
} from './orden-trabajo.util';

/** Tope de fotos por recepcion: son de referencia, no un album. */
export const MAX_FOTOS = 6;
/** Igual que recepcion_fotos_tamano (017). */
export const MAX_BYTES_FOTO = 2 * 1024 * 1024;

const ROLES_PERSONAL = ['admin', 'tecnico', 'superadmin'];

interface Usuario {
  sub: string;
  rol: string;
}

interface FilaOrden {
  turnoId: string;
  tallerId: string;
  usuarioId: string | null;
  inicio: Date;
  fin: Date;
  estado: OrdenTrabajo['turno']['estado'];
  bahia: string;
  servicioId: string;
  servicio: string;
  categoria: string;
  servicioGarantiaDias: number | null;
  tecnicoId: string | null;
  tecnicoNombre: string | null;
  baseCentavos: string | null;
  ivaCentavos: string | null;
  totalCentavos: string | null;
  tarifaIva: number | null;
  anticipoCentavos: string | null;
  anticipoPorStrikes: boolean;
  canceladoPor: 'cliente' | 'taller' | null;
  motivoCancelacion: string | null;
  atencionInicio: Date | null;
  atencionFin: Date | null;
  notas: string | null;
  garantiaDias: number | null;
  garantiaHasta: string | null;
  tallerNombre: string | null;
  razonSocial: string | null;
  nit: string | null;
  dv: number | null;
  direccion: string | null;
  municipio: string | null;
  clienteNombre: string | null;
  clienteEmail: string | null;
  clienteTelefono: string | null;
  vehiculoId: string | null;
  placa: string | null;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
  vehiculoKm: number | null;
  recepcionId: string | null;
  numero: number | null;
  kilometraje: number | null;
  nivelCombustible: number | null;
  estadoVehiculo: string | null;
  objetosDejados: string | null;
  observaciones: string | null;
  fechaProbableEntrega: Date | null;
  recibidoPor: string | null;
  recepcionCreadaEn: Date | null;
  aceptadaEn: Date | null;
  aceptadaMedio: 'cuenta' | 'presencial' | null;
  aceptadaNombre: string | null;
  aceptadaDocumento: string | null;
}

// LEFT JOIN en todo lo que no es del turno: segun quien pregunta, RLS
// puede ocultar una parte (el cliente sin X-Taller no lee los datos
// fiscales) y la orden igual tiene que salir.
const SQL_ORDEN = `
  SELECT t.id AS "turnoId", t.taller_id AS "tallerId", t.usuario_id AS "usuarioId",
         lower(t.rango_tiempo) AS inicio, upper(t.rango_tiempo) AS fin,
         t.estado, b.nombre AS bahia,
         s.id AS "servicioId", s.nombre AS servicio, s.categoria,
         s.garantia_dias AS "servicioGarantiaDias",
         tec.id AS "tecnicoId", tec.nombre AS "tecnicoNombre",
         t.precio_base_centavos AS "baseCentavos", t.iva_centavos AS "ivaCentavos",
         t.total_centavos AS "totalCentavos", t.tarifa_iva AS "tarifaIva",
         t.anticipo_centavos AS "anticipoCentavos",
         t.anticipo_por_strikes AS "anticipoPorStrikes",
         t.cancelado_por AS "canceladoPor", t.motivo_cancelacion AS "motivoCancelacion",
         t.atencion_inicio AS "atencionInicio", t.atencion_fin AS "atencionFin",
         t.notas_atencion AS notas,
         t.garantia_dias AS "garantiaDias",
         to_char(t.garantia_hasta, 'YYYY-MM-DD') AS "garantiaHasta",
         ta.nombre AS "tallerNombre",
         cf.razon_social AS "razonSocial", cf.nit, cf.dv, cf.direccion, cf.municipio,
         cli.nombre AS "clienteNombre", cli.email AS "clienteEmail",
         cli.telefono AS "clienteTelefono",
         v.id AS "vehiculoId", v.placa, v.marca, v.modelo, v.anio,
         v.kilometraje AS "vehiculoKm",
         r.id AS "recepcionId", r.numero, r.kilometraje,
         r.nivel_combustible AS "nivelCombustible",
         r.estado_vehiculo AS "estadoVehiculo", r.objetos_dejados AS "objetosDejados",
         r.observaciones, r.fecha_probable_entrega AS "fechaProbableEntrega",
         rec.nombre AS "recibidoPor", r.creado_en AS "recepcionCreadaEn",
         r.aceptada_en AS "aceptadaEn", r.aceptada_medio AS "aceptadaMedio",
         r.aceptada_nombre AS "aceptadaNombre", r.aceptada_documento AS "aceptadaDocumento"
    FROM turnos t
    JOIN bahias b    ON b.id = t.bahia_id
    JOIN servicios s ON s.id = t.servicio_id
    LEFT JOIN usuarios tec ON tec.id = t.tecnico_id
    LEFT JOIN usuarios cli ON cli.id = t.usuario_id
    LEFT JOIN talleres ta  ON ta.id = t.taller_id
    LEFT JOIN configuracion_fiscal cf ON cf.taller_id = t.taller_id
    LEFT JOIN recepciones r ON r.turno_id = t.id
    -- El vehiculo de la recepcion manda sobre el de la reserva: es el que
    -- efectivamente se recibio.
    LEFT JOIN vehiculos v  ON v.id = COALESCE(r.vehiculo_id, t.vehiculo_id)
    LEFT JOIN usuarios rec ON rec.id = r.recibido_por
   WHERE t.id = $1`;

function iso(d: Date | null): string | null {
  return d ? new Date(d).toISOString() : null;
}

/** Firma del formato: que los bytes sean de verdad la imagen que dicen. */
function coincideFirma(bytes: Buffer, tipo: TipoFoto): boolean {
  if (tipo === 'image/jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (tipo === 'image/png') {
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  return (
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  );
}

/**
 * Recepcion del vehiculo y orden de trabajo (Sprint 22).
 *
 * La recepcion es la constancia de entrega para reparacion (Ley 1480 de
 * 2011): el taller la carga (borrador), el cliente la acepta y desde ahi no
 * cambia mas (trigger de 017) y le llega por correo.
 */
@Injectable()
export class RecepcionesService {
  private readonly logger = new Logger(RecepcionesService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly db: ContextoDb,
    private readonly vehiculos: VehiculosService,
    private readonly correos: CorreosService,
  ) {}

  private consultar<T>(sql: string, params: unknown[]): Promise<T> {
    return this.db.query(sql, params, this.dataSource) as Promise<T>;
  }

  private esPersonal(usuario: Usuario): boolean {
    return ROLES_PERSONAL.includes(usuario.rol);
  }

  /**
   * La orden, si quien pregunta puede verla: el personal del taller de la
   * sesion o el titular del turno. 404 en cualquier otro caso.
   */
  private async fila(turnoId: string, usuario: Usuario): Promise<FilaOrden> {
    const [f] = await this.consultar<FilaOrden[]>(SQL_ORDEN, [turnoId]);
    const taller = this.db.tallerId();
    const visible =
      f &&
      (this.esPersonal(usuario)
        ? f.tallerId === taller
        : f.usuarioId === usuario.sub);
    if (!visible) throw new NotFoundException(`Turno ${turnoId} no encontrado`);
    return f;
  }

  private async fotos(
    recepcionId: string,
  ): Promise<{ id: string; tipoMime: string }[]> {
    return this.consultar(
      `SELECT id, tipo_mime AS "tipoMime" FROM recepcion_fotos
        WHERE recepcion_id = $1 ORDER BY creado_en`,
      [recepcionId],
    );
  }

  private async armar(f: FilaOrden): Promise<OrdenTrabajo> {
    let telefono: string | null = null;
    if (f.clienteTelefono) {
      try {
        telefono = decrypt(f.clienteTelefono);
      } catch {
        // Cifrado con otra llave o dato viejo: la orden sale sin telefono.
        this.logger.warn(
          `No se pudo descifrar el telefono del turno ${f.turnoId}`,
        );
      }
    }
    // Cerrado como atendido: la foto de la garantia. Si no: el termino
    // vigente del servicio, el que se va a aplicar al entregar.
    const cerrado = f.estado === 'atendido';
    const dias = cerrado ? f.garantiaDias : f.servicioGarantiaDias;
    const hasta = cerrado ? f.garantiaHasta : null;
    return {
      numero: f.numero,
      taller: {
        id: f.tallerId,
        nombre: f.tallerNombre ?? '',
        razonSocial: f.razonSocial,
        nit: f.nit,
        dv: f.dv,
        direccion: f.direccion,
        municipio: f.municipio,
      },
      cliente: f.usuarioId
        ? {
            id: f.usuarioId,
            nombre: f.clienteNombre ?? '',
            email: f.clienteEmail ?? '',
            telefono,
          }
        : null,
      turno: {
        id: f.turnoId,
        inicio: iso(f.inicio)!,
        fin: iso(f.fin)!,
        estado: f.estado,
        bahia: f.bahia,
        servicio: {
          id: f.servicioId,
          nombre: f.servicio,
          categoria: f.categoria,
        },
        tecnico: f.tecnicoId
          ? { id: f.tecnicoId, nombre: f.tecnicoNombre ?? '' }
          : null,
        precio:
          f.totalCentavos === null
            ? null
            : {
                baseCentavos: Number(f.baseCentavos),
                ivaCentavos: Number(f.ivaCentavos),
                totalCentavos: Number(f.totalCentavos),
                tarifaIva: f.tarifaIva,
              },
        anticipo:
          f.anticipoCentavos === null
            ? null
            : {
                centavos: Number(f.anticipoCentavos),
                porStrikes: f.anticipoPorStrikes,
              },
        canceladoPor: f.canceladoPor,
        motivoCancelacion: f.motivoCancelacion,
      },
      vehiculo: f.vehiculoId
        ? {
            id: f.vehiculoId,
            placa: f.placa ?? '',
            marca: f.marca ?? '',
            modelo: f.modelo ?? '',
            anio: Number(f.anio),
            kilometraje: Number(f.vehiculoKm),
          }
        : null,
      recepcion: f.recepcionId
        ? {
            id: f.recepcionId,
            numero: Number(f.numero),
            kilometraje: Number(f.kilometraje),
            nivelCombustible: Number(f.nivelCombustible),
            estadoVehiculo: f.estadoVehiculo ?? '',
            objetosDejados: f.objetosDejados ?? '',
            observaciones: f.observaciones,
            fechaProbableEntrega: iso(f.fechaProbableEntrega)!,
            recibidoPor: f.recibidoPor,
            creadoEn: iso(f.recepcionCreadaEn)!,
            aceptacion: f.aceptadaEn
              ? {
                  en: iso(f.aceptadaEn)!,
                  medio: f.aceptadaMedio!,
                  nombre: f.aceptadaNombre,
                  documento: f.aceptadaDocumento,
                }
              : null,
            fotos: await this.fotos(f.recepcionId),
          }
        : null,
      atencion: {
        inicio: iso(f.atencionInicio),
        fin: iso(f.atencionFin),
        notas: f.notas,
      },
      garantia: { dias, hasta, texto: textoGarantia(dias, hasta) },
    };
  }

  async orden(turnoId: string, usuario: Usuario): Promise<OrdenTrabajo> {
    return this.armar(await this.fila(turnoId, usuario));
  }

  /**
   * Crea o corrige el borrador de la recepcion. Aceptada, no se toca (409;
   * el trigger de 017 lo rechaza igual si algo se saltea esto).
   */
  async guardar(
    turnoId: string,
    dto: RecepcionDto,
    usuario: Usuario,
  ): Promise<OrdenTrabajo> {
    const f = await this.fila(turnoId, usuario);
    if (f.aceptadaEn) {
      throw new ConflictException(
        'El cliente ya acepto la recepcion: no se puede modificar.',
      );
    }
    if (f.estado !== 'programado') {
      throw new BadRequestException(
        'Solo se recibe el vehiculo de un turno programado.',
      );
    }
    if (!f.usuarioId) {
      throw new BadRequestException('El turno no tiene cliente.');
    }
    const vehiculo = await this.vehiculos.obtener(dto.vehiculoId);
    if (vehiculo.usuarioId !== f.usuarioId || !vehiculo.activo) {
      throw new BadRequestException(
        'El vehiculo no es del cliente del turno o esta dado de baja.',
      );
    }
    const entrega = dto.fechaProbableEntrega
      ? new Date(dto.fechaProbableEntrega)
      : new Date(f.fin);
    const objetos = dto.objetosDejados?.trim() || 'Ninguno';
    const observaciones = dto.observaciones?.trim() || null;

    if (f.recepcionId) {
      await this.consultar(
        `UPDATE recepciones
            SET vehiculo_id = $2, kilometraje = $3, nivel_combustible = $4,
                estado_vehiculo = $5, objetos_dejados = $6, observaciones = $7,
                fecha_probable_entrega = $8, recibido_por = $9,
                actualizado_en = now()
          WHERE id = $1`,
        [
          f.recepcionId,
          dto.vehiculoId,
          dto.kilometraje,
          dto.nivelCombustible,
          dto.estadoVehiculo.trim(),
          objetos,
          observaciones,
          entrega,
          usuario.sub,
        ],
      );
    } else {
      // Consecutivo por taller sin huecos por carrera: el lock serializa
      // las altas del MISMO taller hasta el fin de la transaccion.
      await this.consultar(
        `SELECT pg_advisory_xact_lock(hashtext('recepciones:' || $1::text))`,
        [f.tallerId],
      );
      await this.consultar(
        `INSERT INTO recepciones (taller_id, turno_id, vehiculo_id, numero,
                                  kilometraje, nivel_combustible, estado_vehiculo,
                                  objetos_dejados, observaciones,
                                  fecha_probable_entrega, recibido_por)
         SELECT $1, $2, $3, COALESCE(max(numero), 0) + 1, $4, $5, $6, $7, $8, $9, $10
           FROM recepciones WHERE taller_id = $1`,
        [
          f.tallerId,
          turnoId,
          dto.vehiculoId,
          dto.kilometraje,
          dto.nivelCombustible,
          dto.estadoVehiculo.trim(),
          objetos,
          observaciones,
          entrega,
          usuario.sub,
        ],
      );
    }
    // El turno queda con el vehiculo que efectivamente llego, y el
    // vehiculo con el kilometraje real (nunca hacia atras).
    await this.consultar('UPDATE turnos SET vehiculo_id = $2 WHERE id = $1', [
      turnoId,
      dto.vehiculoId,
    ]);
    await this.vehiculos.registrarKilometraje(dto.vehiculoId, dto.kilometraje);
    return this.orden(turnoId, usuario);
  }

  /** Recepcion (sin aceptar) de la que el personal del taller agrega o quita fotos. */
  private async recepcionEditable(
    recepcionId: string,
  ): Promise<{ id: string }> {
    const taller = this.db.exigirTaller();
    const [r] = await this.consultar<{ id: string; aceptadaEn: Date | null }[]>(
      `SELECT id, aceptada_en AS "aceptadaEn" FROM recepciones
        WHERE id = $1 AND taller_id = $2`,
      [recepcionId, taller],
    );
    if (!r)
      throw new NotFoundException(`Recepcion ${recepcionId} no encontrada`);
    if (r.aceptadaEn) {
      throw new ConflictException(
        'El cliente ya acepto la recepcion: no se agregan ni quitan fotos.',
      );
    }
    return r;
  }

  async agregarFoto(
    recepcionId: string,
    dto: FotoDto,
  ): Promise<{ id: string; tipoMime: string }> {
    await this.recepcionEditable(recepcionId);
    const base64 = dto.datos.replace(/^data:[^,]*,/, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
      throw new BadRequestException('La foto no esta en base64.');
    }
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_BYTES_FOTO) {
      throw new BadRequestException('Cada foto puede pesar hasta 2 MB.');
    }
    if (!coincideFirma(bytes, dto.tipoMime)) {
      throw new BadRequestException(
        `El archivo no es una imagen ${dto.tipoMime.replace('image/', '').toUpperCase()}.`,
      );
    }
    const [{ total }] = await this.consultar<{ total: number }[]>(
      'SELECT count(*)::int AS total FROM recepcion_fotos WHERE recepcion_id = $1',
      [recepcionId],
    );
    if (total >= MAX_FOTOS) {
      throw new BadRequestException(`Hasta ${MAX_FOTOS} fotos por recepcion.`);
    }
    const [foto] = await this.consultar<{ id: string; tipoMime: string }[]>(
      `INSERT INTO recepcion_fotos (recepcion_id, taller_id, tipo_mime, datos)
       VALUES ($1, $2, $3, $4)
       RETURNING id, tipo_mime AS "tipoMime"`,
      [recepcionId, this.db.exigirTaller(), dto.tipoMime, bytes],
    );
    return foto;
  }

  async quitarFoto(recepcionId: string, fotoId: string): Promise<void> {
    await this.recepcionEditable(recepcionId);
    await this.consultar(
      'DELETE FROM recepcion_fotos WHERE id = $1 AND recepcion_id = $2',
      [fotoId, recepcionId],
    );
  }

  /** Los bytes de una foto (RLS: personal del taller o el titular). */
  async foto(
    recepcionId: string,
    fotoId: string,
  ): Promise<{ tipoMime: string; datos: Buffer }> {
    const [f] = await this.consultar<{ tipoMime: string; datos: Buffer }[]>(
      `SELECT tipo_mime AS "tipoMime", datos FROM recepcion_fotos
        WHERE id = $1 AND recepcion_id = $2`,
      [fotoId, recepcionId],
    );
    if (!f) throw new NotFoundException('Foto no encontrada');
    return f;
  }

  /**
   * Aceptacion de la constancia. El cliente desde su cuenta (titular), o
   * el personal en el mostrador con nombre y documento de quien entrega.
   * Aceptada, sale la constancia por correo (despues del commit).
   */
  async aceptar(
    recepcionId: string,
    dto: AceptarRecepcionDto,
    usuario: Usuario,
  ): Promise<OrdenTrabajo> {
    const [r] = await this.consultar<
      { turnoId: string; aceptadaEn: Date | null }[]
    >(
      `SELECT turno_id AS "turnoId", aceptada_en AS "aceptadaEn"
         FROM recepciones WHERE id = $1`,
      [recepcionId],
    );
    if (!r)
      throw new NotFoundException(`Recepcion ${recepcionId} no encontrada`);
    // Mismo criterio de visibilidad que la orden (y 404 si no le toca).
    const f = await this.fila(r.turnoId, usuario);
    if (r.aceptadaEn) {
      throw new ConflictException('La recepcion ya estaba aceptada.');
    }

    const presencial = this.esPersonal(usuario);
    if (presencial && (!dto.nombre?.trim() || !dto.documento?.trim())) {
      throw new BadRequestException(
        'En el taller, la acepta quien entrega el vehiculo: nombre y documento.',
      );
    }
    if (!presencial && usuario.sub !== f.usuarioId) {
      throw new ForbiddenException('Solo el titular del turno la acepta.');
    }
    // La notificacion de la constancia se escribe en el taller de la
    // sesion (RLS de 015): el cliente tiene que operar en el del turno.
    if (!presencial && this.db.tallerId() !== f.tallerId) {
      throw new BadRequestException(
        'Esa recepcion es de otro taller: elegi ese taller para aceptarla.',
      );
    }
    // aceptar_recepcion() (017) vuelve a verificar quien llama: es
    // SECURITY DEFINER porque el cliente no tiene UPDATE sobre recepciones.
    const aceptadas = await this.consultar<unknown[]>(
      'SELECT id FROM aceptar_recepcion($1, $2, $3, $4)',
      [
        recepcionId,
        presencial ? 'presencial' : 'cuenta',
        dto.nombre ?? null,
        dto.documento ?? null,
      ],
    );
    if (!aceptadas.length) {
      throw new ConflictException('No se pudo aceptar la recepcion.');
    }

    const orden = await this.orden(r.turnoId, usuario);
    if (orden.cliente?.email) {
      await this.correos.encolar({
        turnoId: r.turnoId,
        tipo: 'constancia_recepcion',
        destinatario: orden.cliente.email,
        asunto: `Constancia de recepcion - orden N.° ${orden.recepcion!.numero}`,
        mensaje: textoConstancia(orden, zonaHorariaNegocio()),
      });
    }
    return orden;
  }
}
