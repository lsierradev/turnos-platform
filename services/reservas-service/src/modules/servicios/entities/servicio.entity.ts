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
