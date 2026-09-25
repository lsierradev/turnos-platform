import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum CanalNotificacion {
  EMAIL = 'email',
  WHATSAPP = 'whatsapp',
}

export enum EstadoNotificacion {
  PENDIENTE = 'pendiente',
  ENVIADO = 'enviado',
  FALLIDO = 'fallido',
}

@Entity('notificaciones')
export class Notificacion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Taller al que pertenece (Sprint 20, migracion 015). Lo filtra Row Level
  // Security; el codigo lo completa al crear desde el contexto del request.
  @Column({ name: 'taller_id', type: 'uuid' })
  tallerId: string;

  @Column({ name: 'turno_id' })
  turnoId: string;

  @Column({ type: 'enum', enum: CanalNotificacion })
  canal: CanalNotificacion;

  @Column()
  destinatario: string;

  @Column({ default: 'recordatorio_24h' })
  tipo: string;

  @Column({
    type: 'enum',
    enum: EstadoNotificacion,
    default: EstadoNotificacion.PENDIENTE,
  })
  estado: EstadoNotificacion;

  @Column({ default: 0 })
  intentos: number;

  // El `type` explicito NO es decorativo: sin el, TypeORM deduce el tipo de
  // columna del metadato que emite TypeScript, y para una union como
  // `string | null` ese metadato es `Object`. TypeORM no sabe mapear Object a
  // Postgres y aborta en DataSource.initialize() con
  // DataTypeNotSupportedError -- o sea que el servicio NO ARRANCA, no es que
  // falle una consulta. Los tests unitarios no lo ven porque mockean el
  // DataSource; lo detecta solo un test que conecte de verdad.
  @Column({ type: 'text', nullable: true })
  error?: string | null;

  @Column({ name: 'enviado_en', type: 'timestamptz', nullable: true })
  enviadoEn?: Date | null;

  @CreateDateColumn({ name: 'creado_en' })
  creadoEn: Date;

  @UpdateDateColumn({ name: 'actualizado_en' })
  actualizadoEn: Date;
}
