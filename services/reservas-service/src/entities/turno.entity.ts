import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Servicio } from '../modules/servicios/entities/servicio.entity';
import { Bahia } from './bahia.entity';

export interface RangoTiempo {
  inicio: Date;
  fin: Date;
}

export enum EstadoTurno {
  PROGRAMADO = 'programado',
  ATENDIDO = 'atendido',
  NO_ASISTIO = 'no_asistio',
  CANCELADO = 'cancelado',
}

export type CanceladoPor = 'cliente' | 'taller';

// Postgres representa un tstzrange como "[2024-01-01 10:00:00+00,2024-01-01 11:00:00+00)".
// TypeORM no tiene un ColumnType nativo para range types, asi que se mapea
// como texto y se convierte a/desde { inicio, fin } aca. Confirmado (Sprint 5)
// que Node parsea correctamente ese formato con offset via new Date(...).
//
// La columna es TSTZRANGE (timestamp CON zona horaria), no TSRANGE -- ver
// 007_turnos_rango_tiempo_tstzrange.sql. Con TSRANGE, Postgres descarta el
// offset al guardar y el texto de vuelta no trae zona, asi que new Date(...)
// lo interpretaba como hora LOCAL del proceso en vez de UTC: los horarios se
// corrian silenciosamente en cualquier servidor no-UTC. Se valida contra
// Postgres real via el job integration-tests de CI (no hay Docker en el
// entorno de desarrollo donde se escribio esto).
const rangoTiempoTransformer = {
  to: (value?: RangoTiempo): string | undefined =>
    value
      ? `[${value.inicio.toISOString()},${value.fin.toISOString()})`
      : undefined,
  from: (value?: string): RangoTiempo | undefined => {
    if (!value) {
      return undefined;
    }
    const [inicio, fin] = value
      .replace(/^[[(]/, '')
      .replace(/[\])]$/, '')
      .split(',');
    return { inicio: new Date(inicio), fin: new Date(fin) };
  },
};

// bigint llega de pg como string; los montos en centavos entran holgados
// en un number (hasta 2^53).
const CENTAVOS = {
  to: (v: number | null | undefined) => v,
  from: (v: string | null) => (v === null ? null : Number(v)),
};

@Entity('turnos')
export class Turno {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Taller al que pertenece (Sprint 20, migracion 015). Lo filtra Row Level
  // Security; el codigo lo completa al crear desde el contexto del request.
  @Column({ name: 'taller_id', type: 'uuid' })
  tallerId: string;

  @Column({ name: 'bahia_id' })
  bahiaId: string;

  @Column({ name: 'servicio_id', nullable: true })
  servicioId?: string;

  @Column({ name: 'usuario_id', nullable: true })
  usuarioId?: string;

  // Igual que usuarioId: el tecnico es un Usuario, pero esa entidad
  // pertenece a usuarios-service, asi que aca solo vive el id, sin relacion
  // ORM. Nullable en la DB (ver 006_add_tecnico_a_turnos.sql); obligatorio a
  // nivel de aplicacion via CreateAppointmentDto.
  @Column({ name: 'tecnico_id', nullable: true })
  tecnicoId?: string;

  // Estado y horas reales de atencion (RF-04, ver
  // 009_add_estado_y_atencion_a_turnos.sql). `rangoTiempo` es lo AGENDADO;
  // atencionInicio/atencionFin es lo que realmente paso, y la diferencia
  // entre esos dos es lo que mide el KPI de tiempo promedio de servicio.
  // Nullable: un turno puede cerrarse como 'atendido' sin que nadie haya
  // cronometrado la atencion -- esas filas cuentan para la tasa de
  // asistencia pero quedan fuera del promedio de duracion.
  @Column({
    type: 'enum',
    enum: EstadoTurno,
    enumName: 'estado_turno',
    default: EstadoTurno.PROGRAMADO,
  })
  estado: EstadoTurno;

  @Column({ name: 'atencion_inicio', type: 'timestamptz', nullable: true })
  atencionInicio?: Date | null;

  @Column({ name: 'atencion_fin', type: 'timestamptz', nullable: true })
  atencionFin?: Date | null;

  // Foto del precio al reservar (Sprint 21, migracion 016): cambiar el
  // precio del servicio o la configuracion fiscal no altera turnos ya
  // tomados. NULL en turnos anteriores a 016. tarifaIva NULL = el taller no
  // era responsable de IVA.
  @Column({
    name: 'precio_base_centavos',
    type: 'bigint',
    nullable: true,
    transformer: CENTAVOS,
  })
  precioBaseCentavos?: number | null;

  @Column({
    name: 'iva_centavos',
    type: 'bigint',
    nullable: true,
    transformer: CENTAVOS,
  })
  ivaCentavos?: number | null;

  @Column({
    name: 'total_centavos',
    type: 'bigint',
    nullable: true,
    transformer: CENTAVOS,
  })
  totalCentavos?: number | null;

  @Column({ name: 'tarifa_iva', type: 'smallint', nullable: true })
  tarifaIva?: number | null;

  @Column({
    name: 'anticipo_centavos',
    type: 'bigint',
    nullable: true,
    transformer: CENTAVOS,
  })
  anticipoCentavos?: number | null;

  // 3 strikes vigentes al reservar (Sprint 22): anticipo = total, se paga
  // el 100% por adelantado (el cobro llega en el Sprint 24).
  @Column({ name: 'anticipo_por_strikes', default: false })
  anticipoPorStrikes: boolean;

  // Sprint 22 (migracion 017). Vehiculo del cliente que trae al turno.
  @Column({ name: 'vehiculo_id', type: 'uuid', nullable: true })
  vehiculoId?: string | null;

  // Quien cancelo: 'taller' nunca genera strike al cliente. NULL en los
  // cancelados anteriores a 017 y en todo turno no cancelado.
  @Column({ name: 'cancelado_por', type: 'text', nullable: true })
  canceladoPor?: CanceladoPor | null;

  @Column({ name: 'cancelado_en', type: 'timestamptz', nullable: true })
  canceladoEn?: Date | null;

  @Column({ name: 'motivo_cancelacion', type: 'text', nullable: true })
  motivoCancelacion?: string | null;

  // Reprogramar = cancelar este turno y crear otro: apunta al nuevo.
  @Column({ name: 'reprogramado_a', type: 'uuid', nullable: true })
  reprogramadoA?: string | null;

  @Column({ name: 'notas_atencion', type: 'text', nullable: true })
  notasAtencion?: string | null;

  // Foto de la garantia al cerrar como atendido (Decreto 735 de 2013).
  // garantiaDias NULL con el turno atendido: el servicio no tenia termino
  // definido y rige la garantia legal.
  @Column({ name: 'garantia_dias', type: 'smallint', nullable: true })
  garantiaDias?: number | null;

  // DATE: el dia (del taller) hasta el que cubre, inclusive.
  @Column({ name: 'garantia_hasta', type: 'date', nullable: true })
  garantiaHasta?: string | null;

  @Column({
    name: 'rango_tiempo',
    type: 'tstzrange' as 'text',
    transformer: rangoTiempoTransformer,
  })
  rangoTiempo: RangoTiempo;

  @ManyToOne(() => Bahia)
  @JoinColumn({ name: 'bahia_id' })
  bahia?: Bahia;

  @ManyToOne(() => Servicio)
  @JoinColumn({ name: 'servicio_id' })
  servicio?: Servicio;

  @CreateDateColumn({ name: 'creado_en' })
  creadoEn: Date;

  @UpdateDateColumn({ name: 'actualizado_en' })
  actualizadoEn: Date;
}
