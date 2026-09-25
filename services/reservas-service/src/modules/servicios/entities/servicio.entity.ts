import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum CategoriaServicio {
  MECANICA = 'mecanica',
  ELECTRICA = 'electrica',
  LATONERIA = 'latoneria',
}

@Entity('servicios')
export class Servicio {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Taller al que pertenece (Sprint 20, migracion 015). Lo filtra Row Level
  // Security; el codigo lo completa al crear desde el contexto del request.
  @Column({ name: 'taller_id', type: 'uuid' })
  tallerId: string;

  @Column()
  nombre: string;

  @Column({ type: 'enum', enum: CategoriaServicio })
  categoria: CategoriaServicio;

  @Column({ name: 'duracion_minutos' })
  duracionMinutos: number;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  precio: number;

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'creado_en' })
  creadoEn: Date;

  @UpdateDateColumn({ name: 'actualizado_en' })
  actualizadoEn: Date;
}
