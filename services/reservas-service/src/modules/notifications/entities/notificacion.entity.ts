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

  @Column({ nullable: true })
  error?: string | null;

  @Column({ name: 'enviado_en', nullable: true })
  enviadoEn?: Date | null;

  @CreateDateColumn({ name: 'creado_en' })
  creadoEn: Date;

  @UpdateDateColumn({ name: 'actualizado_en' })
  actualizadoEn: Date;
}
