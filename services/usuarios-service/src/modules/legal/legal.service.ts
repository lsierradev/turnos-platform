import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ContextoDb, Sesion } from '@turnos-platform/tenant';
import {
  buscarVersion,
  CATALOGO,
  DOCUMENTOS_PLATAFORMA,
  documentosDelRol,
  DocumentoPlataforma,
  leerTexto,
  marcasPendientes,
  PLANTILLA_CONDICIONES,
  sha256,
  TipoDocumento,
  TITULO_CONDICIONES,
  versionVigente,
} from './catalogo';
import { DatosPlantilla, llenarPlantilla } from './plantilla';

export type Canal = 'web' | 'app' | 'presencial';

/** Un documento listo para mostrar y aceptar. */
export interface DocumentoLegal {
  documento: TipoDocumento;
  version: number;
  titulo: string;
  sha256: string;
  vigenteDesde: string;
  borrador: boolean;
  /** Solo condiciones_taller. */
  tallerId?: string;
  contenido: string;
}

export interface Aceptacion {
  id: string;
  documento: TipoDocumento;
  version: number;
  sha256: string;
  tallerId: string | null;
  tallerNombre: string | null;
  canal: Canal;
  ip: string | null;
  registradoPor: string | null;
  aceptadoEn: string;
}

/** Donde se origino una aceptacion (la guarda el controller). */
export interface Origen {
  ip: string | null;
  userAgent: string | null;
}

export interface VersionCondiciones {
  version: number;
  sha256: string;
  plantillaVersion: number;
  publicadoEn: string;
  publicadoPor: string | null;
  aceptaciones: number;
}

export interface EstadoCondiciones {
  /** null: el taller todavia no publico condiciones (nada que aceptar). */
  vigente: DocumentoLegal | null;
  aceptada: boolean;
}

function documentoPlataforma(
  tipo: DocumentoPlataforma,
  version = versionVigente(tipo),
): DocumentoLegal {
  return {
    documento: tipo,
    version: version.version,
    titulo: CATALOGO[tipo].titulo,
    sha256: version.sha256,
    vigenteDesde: version.vigenteDesde,
    borrador: version.borrador,
    contenido: leerTexto(version.archivo),
  };
}

/**
 * Documentos legales y registro de aceptaciones (Sprint 23).
 *
 * Cada aceptacion guarda usuario, documento, version, SHA-256 del texto,
 * fecha, IP y canal (tabla aceptaciones_legales). Que un documento este
 * "pendiente" se decide comparando la ultima version aceptada con la
 * vigente: publicar una version nueva vuelve a pedir la aceptacion.
 */
@Injectable()
export class LegalService implements OnModuleInit {
  private readonly logger = new Logger(LegalService.name);

  constructor(private readonly db: ContextoDb) {}

  /**
   * Los textos vigentes son borradores hasta que los revise un abogado. En
   * produccion se avisa fuerte al arrancar; no se corta el arranque para
   * no bloquear un staging que corre con NODE_ENV=production (el corte es
   * el checklist de docs/GO-LIVE.md).
   */
  onModuleInit(): void {
    const borradores = DOCUMENTOS_PLATAFORMA.filter(
      (t) => versionVigente(t).borrador,
    );
    if (process.env.NODE_ENV === 'production' && borradores.length) {
      this.logger.warn(
        `Documentos legales vigentes en BORRADOR (sin revision de abogado): ${borradores.join(', ')}`,
      );
    }
  }

  // ----------------------------------------------------------- publicos

  documentosVigentes(): Omit<DocumentoLegal, 'contenido'>[] {
    return DOCUMENTOS_PLATAFORMA.map((t) => {
      const { contenido: _contenido, ...resto } = documentoPlataforma(t);
      return resto;
    });
  }

  documento(tipo: DocumentoPlataforma, version?: number): DocumentoLegal {
    if (version === undefined) return documentoPlataforma(tipo);
    const encontrada = buscarVersion(tipo, version);
    if (!encontrada) {
      throw new NotFoundException(
        `No existe la version ${version} de ${CATALOGO[tipo].titulo}.`,
      );
    }
    return documentoPlataforma(tipo, encontrada);
  }

  /**
   * Condiciones vigentes de un taller: publicas, las lee quien todavia no
   * reservo (y no tiene sesion). Sin version, la ultima.
   */
  async condicionesDeTaller(
    tallerId: string,
    version?: number,
  ): Promise<DocumentoLegal | null> {
    const filas = await this.db.query<
      {
        version: number;
        contenido: string;
        sha256: string;
        publicadoEn: Date;
      }[]
    >(
      `SELECT version, contenido, sha256, publicado_en AS "publicadoEn"
         FROM condiciones_taller
        WHERE taller_id = $1 AND ($2::int IS NULL OR version = $2)
        ORDER BY version DESC
        LIMIT 1`,
      [tallerId, version ?? null],
    );
    const fila = filas[0];
    if (!fila) return null;
    return {
      documento: 'condiciones_taller',
      version: fila.version,
      titulo: TITULO_CONDICIONES,
      sha256: fila.sha256,
      vigenteDesde: fila.publicadoEn.toISOString().slice(0, 10),
      borrador: false,
      tallerId,
      contenido: fila.contenido,
    };
  }

  // ---------------------------------------------------------- pendientes

  /**
   * Lo que el usuario tiene que aceptar antes de seguir: los documentos de
   * la plataforma de su rol cuya version vigente no acepto. Los terminos
   * del taller son del TALLER: con que un admin acepte la version vigente,
   * no se le vuelven a pedir a los otros admins de ese taller.
   *
   * La constancia 'presencial' que deja el admin al dar de alta a un
   * cliente no cuenta aca: el titular igual lee y acepta por si mismo en
   * su primer ingreso.
   */
  async pendientes(sesion: Sesion): Promise<DocumentoLegal[]> {
    const documentos = documentosDelRol(sesion.rol);
    if (!documentos.length) return [];

    const aceptadas = await this.db.query<
      { documento: DocumentoPlataforma; version: number }[]
    >(
      `SELECT documento, max(version)::int AS version
         FROM aceptaciones_legales
        WHERE documento = ANY($1)
          AND ((documento = 'terminos_taller' AND taller_id = $2)
               OR (documento <> 'terminos_taller' AND usuario_id = $3
                   AND canal <> 'presencial'))
        GROUP BY documento`,
      [documentos, sesion.tallerId, sesion.usuarioId],
    );
    const ultima = new Map(aceptadas.map((a) => [a.documento, a.version]));
    return documentos
      .filter((d) => (ultima.get(d) ?? 0) < versionVigente(d).version)
      .map((d) => documentoPlataforma(d));
  }

  // ------------------------------------------------------------ aceptar

  /**
   * El usuario acepta la version que vio. Si mientras leia se publico otra,
   * 409: aceptar un texto que no es el vigente no sirve de nada.
   */
  async aceptar(
    sesion: Sesion,
    dto: {
      documento: TipoDocumento;
      version: number;
      canal: Exclude<Canal, 'presencial'>;
    },
    origen: Origen,
  ): Promise<Aceptacion> {
    const { documento, version } = dto;
    let tallerId: string | null = null;
    let hash: string;

    if (documento === 'condiciones_taller') {
      tallerId = this.db.exigirTaller();
      const vigente = await this.condicionesDeTaller(tallerId);
      if (!vigente) {
        throw new NotFoundException(
          'Este taller todavia no publico sus condiciones.',
        );
      }
      this.exigirVigente(version, vigente.version);
      hash = vigente.sha256;
    } else {
      if (!documentosDelRol(sesion.rol).includes(documento)) {
        throw new ForbiddenException(
          'Ese documento no es para tu tipo de cuenta.',
        );
      }
      const vigente = versionVigente(documento);
      this.exigirVigente(version, vigente.version);
      hash = vigente.sha256;
      if (documento === 'terminos_taller') tallerId = this.db.exigirTaller();
    }

    return this.registrar({
      usuarioId: sesion.usuarioId,
      documento,
      version,
      sha256: hash,
      tallerId,
      canal: dto.canal,
      registradoPor: null,
      origen,
    });
  }

  /**
   * El admin deja constancia de que un cliente de su taller acepto en el
   * mostrador (canal 'presencial'): al darlo de alta (politica y
   * autorizacion) o al reservar por el (condiciones del taller). Siempre la
   * version vigente: es la que el admin tiene en pantalla.
   */
  async aceptarPresencial(
    sesion: Sesion,
    clienteId: string,
    documentos: TipoDocumento[],
    origen: Origen,
  ): Promise<Aceptacion[]> {
    const tallerId = this.db.exigirTaller();
    const [relacion] = await this.db.query<{ ok: number }[]>(
      `SELECT 1 AS ok FROM clientes_taller
        WHERE taller_id = $1 AND usuario_id = $2`,
      [tallerId, clienteId],
    );
    if (!relacion) {
      throw new NotFoundException(
        `Cliente ${clienteId} no encontrado en este taller.`,
      );
    }

    const registradas: Aceptacion[] = [];
    for (const documento of documentos) {
      let version: number;
      let hash: string;
      if (documento === 'condiciones_taller') {
        const vigente = await this.condicionesDeTaller(tallerId);
        if (!vigente) continue;
        version = vigente.version;
        hash = vigente.sha256;
      } else if (documento === 'terminos_taller') {
        throw new BadRequestException(
          'Los terminos de TurnoPro los acepta el taller, no el cliente.',
        );
      } else {
        const vigente = versionVigente(documento);
        version = vigente.version;
        hash = vigente.sha256;
      }
      registradas.push(
        await this.registrar({
          usuarioId: clienteId,
          documento,
          version,
          sha256: hash,
          tallerId,
          canal: 'presencial',
          registradoPor: sesion.usuarioId,
          origen,
        }),
      );
    }
    return registradas;
  }

  async mias(usuarioId: string): Promise<Aceptacion[]> {
    return this.db.query<Aceptacion[]>(
      `${SELECT_ACEPTACION}
        WHERE a.usuario_id = $1
        ORDER BY a.aceptado_en DESC`,
      [usuarioId],
    );
  }

  // ------------------------------------------- condiciones del taller

  /**
   * Borrador para el editor del admin: la ultima version publicada o, si
   * no hay (o lo pide), la plantilla de TurnoPro llena con los datos del
   * taller.
   */
  async borradorCondiciones(desdePlantilla: boolean): Promise<{
    contenido: string;
    basadoEn: 'plantilla' | 'publicada';
    plantillaVersion: number;
    pendientes: string[];
  }> {
    const tallerId = this.db.exigirTaller();
    const publicada = desdePlantilla
      ? null
      : await this.condicionesDeTaller(tallerId);
    const contenido =
      publicada?.contenido ??
      llenarPlantilla(
        leerTexto(PLANTILLA_CONDICIONES.archivo),
        await this.datosPlantilla(tallerId),
      );
    return {
      contenido,
      basadoEn: publicada ? 'publicada' : 'plantilla',
      plantillaVersion: PLANTILLA_CONDICIONES.version,
      pendientes: marcasPendientes(contenido),
    };
  }

  async versionesCondiciones(): Promise<VersionCondiciones[]> {
    const tallerId = this.db.exigirTaller();
    return this.db.query<VersionCondiciones[]>(
      `SELECT c.version, c.sha256, c.plantilla_version AS "plantillaVersion",
              c.publicado_en AS "publicadoEn", u.nombre AS "publicadoPor",
              (SELECT count(DISTINCT a.usuario_id)::int FROM aceptaciones_legales a
                WHERE a.documento = 'condiciones_taller' AND a.taller_id = c.taller_id
                  AND a.version = c.version) AS aceptaciones
         FROM condiciones_taller c
         LEFT JOIN usuarios u ON u.id = c.publicado_por
        WHERE c.taller_id = $1
        ORDER BY c.version DESC`,
      [tallerId],
    );
  }

  /**
   * Publica una version nueva. Desde ese momento, cada cliente tiene que
   * aceptarla para su proxima reserva en el taller (lo exige
   * reservas-service al crear el turno).
   */
  async publicarCondiciones(
    sesion: Sesion,
    contenido: string,
  ): Promise<DocumentoLegal> {
    const tallerId = this.db.exigirTaller();
    const texto = contenido.replace(/\r\n/g, '\n').trim() + '\n';
    const marcas = marcasPendientes(texto);
    if (marcas.length) {
      throw new BadRequestException({
        message:
          'Completa o quita las marcas pendientes antes de publicar: ' +
          [...new Set(marcas)].slice(0, 5).join(' · '),
        pendientes: marcas,
      });
    }

    const actual = await this.condicionesDeTaller(tallerId);
    const hash = sha256(texto);
    if (actual?.sha256 === hash) {
      throw new ConflictException(
        `Es el mismo texto de la version ${actual.version}: no hay nada nuevo que publicar.`,
      );
    }

    try {
      await this.db.query(
        `INSERT INTO condiciones_taller
           (taller_id, version, contenido, sha256, plantilla_version, publicado_por)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          tallerId,
          (actual?.version ?? 0) + 1,
          texto,
          hash,
          PLANTILLA_CONDICIONES.version,
          sesion.usuarioId,
        ],
      );
    } catch (error) {
      // Dos admins publicando a la vez: la PK (taller, version) deja pasar
      // a uno solo.
      const e = error as { code?: string; driverError?: { code?: string } };
      if ((e.code ?? e.driverError?.code) === '23505') {
        throw new ConflictException(
          'Otro administrador acaba de publicar una version. Recarga y revisa.',
        );
      }
      throw error;
    }
    return (await this.condicionesDeTaller(tallerId))!;
  }

  /** Si el cliente (o el titular del turno) acepto las condiciones vigentes. */
  async estadoCondiciones(usuarioId: string): Promise<EstadoCondiciones> {
    const tallerId = this.db.exigirTaller();
    const vigente = await this.condicionesDeTaller(tallerId);
    if (!vigente) return { vigente: null, aceptada: true };
    const [fila] = await this.db.query<{ ok: number }[]>(
      `SELECT 1 AS ok FROM aceptaciones_legales
        WHERE usuario_id = $1 AND documento = 'condiciones_taller'
          AND taller_id = $2 AND version = $3
        LIMIT 1`,
      [usuarioId, tallerId, vigente.version],
    );
    return { vigente, aceptada: !!fila };
  }

  // ------------------------------------------------------------ privados

  private exigirVigente(aceptada: number, vigente: number): void {
    if (aceptada !== vigente) {
      throw new ConflictException({
        message: `Se publico una version nueva (${vigente}). Leela antes de aceptar.`,
        versionVigente: vigente,
      });
    }
  }

  private async registrar(a: {
    usuarioId: string;
    documento: TipoDocumento;
    version: number;
    sha256: string;
    tallerId: string | null;
    canal: Canal;
    registradoPor: string | null;
    origen: Origen;
  }): Promise<Aceptacion> {
    const [fila] = await this.db.query<{ id: string }[]>(
      `INSERT INTO aceptaciones_legales
         (usuario_id, documento, version, sha256, taller_id, canal, ip,
          user_agent, registrado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        a.usuarioId,
        a.documento,
        a.version,
        a.sha256,
        a.tallerId,
        a.canal,
        a.origen.ip,
        a.origen.userAgent?.slice(0, 500) ?? null,
        a.registradoPor,
      ],
    );
    const [aceptacion] = await this.db.query<Aceptacion[]>(
      `${SELECT_ACEPTACION} WHERE a.id = $1`,
      [fila.id],
    );
    return aceptacion;
  }

  private async datosPlantilla(tallerId: string): Promise<DatosPlantilla> {
    const [fila] = await this.db.query<DatosPlantilla[]>(
      `SELECT t.nombre, f.razon_social AS "razonSocial", f.nit, f.dv,
              f.direccion, f.municipio,
              coalesce(f.responsable_iva, false) AS "responsableIva",
              coalesce(p.ventana_horas, 4)::int AS "ventanaHoras",
              coalesce(p.vigencia_strikes_meses, 12)::int AS "vigenciaStrikesMeses"
         FROM talleres t
         LEFT JOIN configuracion_fiscal f ON f.taller_id = t.id
         LEFT JOIN politica_cancelacion p ON p.taller_id = t.id
        WHERE t.id = $1`,
      [tallerId],
    );
    if (!fila) throw new NotFoundException('Taller no encontrado.');
    return fila;
  }
}

const SELECT_ACEPTACION = `
  SELECT a.id, a.documento, a.version, a.sha256, a.taller_id AS "tallerId",
         t.nombre AS "tallerNombre", a.canal, host(a.ip) AS ip,
         r.nombre AS "registradoPor", a.aceptado_en AS "aceptadoEn"
    FROM aceptaciones_legales a
    LEFT JOIN talleres t ON t.id = a.taller_id
    LEFT JOIN usuarios r ON r.id = a.registrado_por`;
