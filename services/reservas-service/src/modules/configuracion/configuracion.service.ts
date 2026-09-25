import { BadRequestException, Injectable } from '@nestjs/common';
import { decrypt, encrypt } from '@turnos-platform/crypto';
import { ContextoDb } from '@turnos-platform/tenant';
import { DataSource } from 'typeorm';
import { horaAMinutos } from '../../common/horario.util';
import {
  fechaEnZona,
  sumarDiasFecha,
  zonaHorariaNegocio,
} from '../../common/zona-horaria.util';
import {
  DatosFiscalesDto,
  FacturacionDto,
  FeriadoDto,
  HorarioDto,
  WompiDto,
} from './dto/configuracion.dto';
import { festivosDeColombia } from './festivos-colombia.util';
import { digitoVerificacion, normalizarNit } from './nit.util';
import { ValidadorProveedores } from './validador-proveedores.service';

interface FilaFiscal {
  razonSocial: string | null;
  nit: string | null;
  dv: number | null;
  direccion: string | null;
  municipio: string | null;
  departamento: string | null;
  responsableIva: boolean;
  proveedor: 'alegra' | 'siigo' | null;
  usuario: string | null;
  token: string | null;
  ambiente: 'pruebas' | 'produccion' | null;
  llavePublica: string | null;
  llavePrivada: string | null;
  secretoIntegridad: string | null;
  secretoEventos: string | null;
}

export interface ConfiguracionFiscal {
  razonSocial: string | null;
  nit: string | null;
  dv: number | null;
  direccion: string | null;
  municipio: string | null;
  departamento: string | null;
  responsableIva: boolean;
  /** Datos minimos para facturar cargados. */
  completa: boolean;
  facturacion: {
    proveedor: 'alegra' | 'siigo';
    usuario: string;
    /** Solo los ultimos 4 caracteres. */
    token: string;
  } | null;
  wompi: {
    ambiente: 'pruebas' | 'produccion';
    llavePublica: string;
    llavePrivada: string | null;
    secretoIntegridad: string | null;
    secretoEventos: string | null;
  } | null;
}

const SQL_FISCAL = `
  SELECT f.razon_social        AS "razonSocial",
         f.nit, f.dv, f.direccion, f.municipio, f.departamento,
         f.responsable_iva     AS "responsableIva",
         c.proveedor_facturacion AS proveedor,
         c.facturacion_usuario AS usuario,
         c.facturacion_token_cifrado AS token,
         c.wompi_ambiente      AS ambiente,
         c.wompi_llave_publica AS "llavePublica",
         c.wompi_llave_privada_cifrada AS "llavePrivada",
         c.wompi_secreto_integridad_cifrado AS "secretoIntegridad",
         c.wompi_secreto_eventos_cifrado AS "secretoEventos"
    FROM configuracion_fiscal f
    JOIN credenciales_taller c ON c.taller_id = f.taller_id
   WHERE f.taller_id = $1`;

/**
 * Un secreto nunca vuelve completo por la API: solo lo necesario para que
 * el admin reconozca cual cargo. Se descifra para sacar los ultimos 4 (el
 * texto cifrado no dice nada).
 */
export function enmascarar(cifrado: string | null): string | null {
  if (!cifrado) return null;
  const claro = decrypt(cifrado);
  return `••••${claro.slice(-4)}`;
}

/** Turnos que vienen y quedan fuera del horario o en un dia cerrado. */
const SQL_TURNOS_FUERA_DE_HORARIO = `
  SELECT count(*)::int AS total
    FROM turnos t
    LEFT JOIN horarios_taller h
           ON h.taller_id = t.taller_id
          AND h.dia_semana = extract(isodow FROM lower(t.rango_tiempo) AT TIME ZONE $2)
    LEFT JOIN feriados_taller f
           ON f.taller_id = t.taller_id
          AND f.fecha = (lower(t.rango_tiempo) AT TIME ZONE $2)::date
   WHERE t.taller_id = $1
     AND t.estado = 'programado'
     AND lower(t.rango_tiempo) > now()
     AND (h.dia_semana IS NULL
          OR f.fecha IS NOT NULL
          OR (lower(t.rango_tiempo) AT TIME ZONE $2)::time < h.apertura
          OR (upper(t.rango_tiempo) AT TIME ZONE $2)::time > h.cierre
          OR (upper(t.rango_tiempo) AT TIME ZONE $2)::date
             <> (lower(t.rango_tiempo) AT TIME ZONE $2)::date)`;

@Injectable()
export class ConfiguracionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly db: ContextoDb,
    private readonly validador: ValidadorProveedores,
  ) {}

  private consultar<T>(sql: string, params: unknown[]): Promise<T> {
    return this.db.query(sql, params, this.dataSource) as Promise<T>;
  }

  // ------------------------------------------------------------- fiscal

  async obtenerFiscal(): Promise<ConfiguracionFiscal> {
    const taller = this.db.exigirTaller();
    const [f] = await this.consultar<FilaFiscal[]>(SQL_FISCAL, [taller]);
    return {
      razonSocial: f.razonSocial,
      nit: f.nit,
      dv: f.dv,
      direccion: f.direccion,
      municipio: f.municipio,
      departamento: f.departamento,
      responsableIva: f.responsableIva,
      completa: Boolean(f.razonSocial && f.nit && f.direccion && f.municipio),
      facturacion:
        f.proveedor && f.usuario && f.token
          ? {
              proveedor: f.proveedor,
              usuario: f.usuario,
              token: enmascarar(f.token)!,
            }
          : null,
      wompi:
        f.ambiente && f.llavePublica
          ? {
              ambiente: f.ambiente,
              llavePublica: f.llavePublica,
              llavePrivada: enmascarar(f.llavePrivada),
              secretoIntegridad: enmascarar(f.secretoIntegridad),
              secretoEventos: enmascarar(f.secretoEventos),
            }
          : null,
    };
  }

  async actualizarDatosFiscales(
    dto: DatosFiscalesDto,
  ): Promise<ConfiguracionFiscal> {
    const taller = this.db.exigirTaller();
    const nit = normalizarNit(dto.nit);
    if (!/^[0-9]{5,15}$/.test(nit)) {
      throw new BadRequestException(
        'El NIT tiene que tener entre 5 y 15 digitos.',
      );
    }
    const esperado = digitoVerificacion(nit);
    if (esperado !== dto.dv) {
      throw new BadRequestException(
        `El digito de verificacion no coincide con el NIT ${nit} (deberia ser ${esperado}). Revisa el RUT.`,
      );
    }
    await this.consultar(
      `UPDATE configuracion_fiscal
          SET razon_social = $2, nit = $3, dv = $4, direccion = $5,
              municipio = $6, departamento = $7, responsable_iva = $8,
              actualizado_en = now()
        WHERE taller_id = $1`,
      [
        taller,
        dto.razonSocial.trim(),
        nit,
        dto.dv,
        dto.direccion.trim(),
        dto.municipio.trim(),
        dto.departamento.trim(),
        dto.responsableIva,
      ],
    );
    return this.obtenerFiscal();
  }

  async actualizarFacturacion(
    dto: FacturacionDto,
  ): Promise<ConfiguracionFiscal & { validado: boolean }> {
    const taller = this.db.exigirTaller();
    if (dto.proveedor === 'siigo') {
      throw new BadRequestException(
        'Siigo todavia no esta disponible. Por ahora la facturacion electronica es con Alegra.',
      );
    }
    const validado = await this.validador.validarAlegra(
      dto.usuario.trim(),
      dto.token.trim(),
    );
    await this.consultar(
      `UPDATE credenciales_taller
          SET proveedor_facturacion = $2, facturacion_usuario = $3,
              facturacion_token_cifrado = $4, actualizado_en = now()
        WHERE taller_id = $1`,
      [taller, dto.proveedor, dto.usuario.trim(), encrypt(dto.token.trim())],
    );
    return { ...(await this.obtenerFiscal()), validado };
  }

  async actualizarWompi(
    dto: WompiDto,
  ): Promise<ConfiguracionFiscal & { validado: boolean }> {
    const taller = this.db.exigirTaller();
    const [actual] = await this.consultar<FilaFiscal[]>(SQL_FISCAL, [taller]);

    // Lo que no viene, se conserva. Pero si cambia el ambiente, lo guardado
    // es del otro ambiente y ya no sirve: hay que pegar todo de nuevo.
    const mismoAmbiente = actual.ambiente === dto.ambiente;
    const conservar = (nuevo: string | undefined, cifrado: string | null) =>
      nuevo?.trim() ??
      (mismoAmbiente && cifrado ? decrypt(cifrado) : undefined);

    const llavePrivada = conservar(dto.llavePrivada, actual.llavePrivada);
    const secretoIntegridad = conservar(
      dto.secretoIntegridad,
      actual.secretoIntegridad,
    );
    const secretoEventos = conservar(dto.secretoEventos, actual.secretoEventos);
    if (!llavePrivada || !secretoIntegridad || !secretoEventos) {
      throw new BadRequestException(
        mismoAmbiente
          ? 'Faltan la llave privada y los secretos de integridad y de eventos de Wompi.'
          : `Al pasar a ${dto.ambiente} hay que cargar de nuevo la llave privada y los dos secretos de ese ambiente.`,
      );
    }

    const validado = await this.validador.validarWompi({
      ambiente: dto.ambiente,
      llavePublica: dto.llavePublica.trim(),
      llavePrivada,
      secretoIntegridad,
      secretoEventos,
    });
    await this.consultar(
      `UPDATE credenciales_taller
          SET wompi_ambiente = $2, wompi_llave_publica = $3,
              wompi_llave_privada_cifrada = $4,
              wompi_secreto_integridad_cifrado = $5,
              wompi_secreto_eventos_cifrado = $6,
              actualizado_en = now()
        WHERE taller_id = $1`,
      [
        taller,
        dto.ambiente,
        dto.llavePublica.trim(),
        encrypt(llavePrivada),
        encrypt(secretoIntegridad),
        encrypt(secretoEventos),
      ],
    );
    return { ...(await this.obtenerFiscal()), validado };
  }

  // ------------------------------------------------------------ horario

  async obtenerHorario(): Promise<{
    dias: { dia: number; apertura: string; cierre: string }[];
    feriados: { fecha: string; motivo: string }[];
  }> {
    const taller = this.db.exigirTaller();
    const dias = await this.consultar<
      { dia: number; apertura: string; cierre: string }[]
    >(
      `SELECT dia_semana AS dia,
              to_char(apertura, 'HH24:MI') AS apertura,
              to_char(cierre, 'HH24:MI') AS cierre
         FROM horarios_taller WHERE taller_id = $1 ORDER BY dia_semana`,
      [taller],
    );
    // Desde hoy: los pasados no le sirven a nadie para planificar.
    const hoy = fechaEnZona(new Date(), zonaHorariaNegocio());
    const feriados = await this.consultar<{ fecha: string; motivo: string }[]>(
      `SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, motivo
         FROM feriados_taller WHERE taller_id = $1 AND fecha >= $2::date
        ORDER BY fecha`,
      [taller, hoy],
    );
    return { dias: dias.map((d) => ({ ...d, dia: Number(d.dia) })), feriados };
  }

  /**
   * Reemplaza la semana entera. Los turnos ya tomados fuera del horario
   * nuevo NO se cancelan (el taller decide que hacer con cada uno): se
   * cuentan para avisar.
   */
  async actualizarHorario(
    dto: HorarioDto,
  ): Promise<{ turnosFueraDeHorario: number }> {
    const taller = this.db.exigirTaller();
    const vistos = new Set<number>();
    for (const d of dto.dias) {
      if (vistos.has(d.dia)) {
        throw new BadRequestException(`El dia ${d.dia} esta repetido.`);
      }
      vistos.add(d.dia);
      if (horaAMinutos(d.apertura) >= horaAMinutos(d.cierre)) {
        throw new BadRequestException(
          `El cierre tiene que ser despues de la apertura (dia ${d.dia}: ${d.apertura}-${d.cierre}).`,
        );
      }
    }
    await this.consultar('DELETE FROM horarios_taller WHERE taller_id = $1', [
      taller,
    ]);
    for (const d of dto.dias) {
      await this.consultar(
        `INSERT INTO horarios_taller (taller_id, dia_semana, apertura, cierre)
         VALUES ($1, $2, $3, $4)`,
        [taller, d.dia, d.apertura, d.cierre],
      );
    }
    return {
      turnosFueraDeHorario: await this.contarTurnosFueraDeHorario(taller),
    };
  }

  async agregarFeriado(
    dto: FeriadoDto,
  ): Promise<{ turnosFueraDeHorario: number }> {
    const taller = this.db.exigirTaller();
    if (sumarDiasFecha(dto.fecha, 0) !== dto.fecha) {
      throw new BadRequestException(`La fecha ${dto.fecha} no existe.`);
    }
    await this.consultar(
      `INSERT INTO feriados_taller (taller_id, fecha, motivo) VALUES ($1, $2, $3)
       ON CONFLICT (taller_id, fecha) DO UPDATE SET motivo = EXCLUDED.motivo`,
      [taller, dto.fecha, dto.motivo.trim()],
    );
    return {
      turnosFueraDeHorario: await this.contarTurnosFueraDeHorario(taller),
    };
  }

  async eliminarFeriado(fecha: string): Promise<void> {
    const taller = this.db.exigirTaller();
    await this.consultar(
      'DELETE FROM feriados_taller WHERE taller_id = $1 AND fecha = $2::date',
      [taller, fecha],
    );
  }

  /** Carga los festivos nacionales del ano; no pisa los que ya existen. */
  async importarFestivosColombia(
    anio: number,
  ): Promise<{ agregados: number; turnosFueraDeHorario: number }> {
    const taller = this.db.exigirTaller();
    let agregados = 0;
    for (const f of festivosDeColombia(anio)) {
      const filas = await this.consultar<unknown[]>(
        `INSERT INTO feriados_taller (taller_id, fecha, motivo) VALUES ($1, $2, $3)
         ON CONFLICT (taller_id, fecha) DO NOTHING
         RETURNING fecha`,
        [taller, f.fecha, f.motivo],
      );
      agregados += filas.length;
    }
    return {
      agregados,
      turnosFueraDeHorario: await this.contarTurnosFueraDeHorario(taller),
    };
  }

  private async contarTurnosFueraDeHorario(taller: string): Promise<number> {
    const [fila] = await this.consultar<{ total: number }[]>(
      SQL_TURNOS_FUERA_DE_HORARIO,
      [taller, zonaHorariaNegocio()],
    );
    return fila.total;
  }
}
