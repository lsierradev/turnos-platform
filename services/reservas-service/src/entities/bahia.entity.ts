import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('bahias')
export class Bahia {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Taller al que pertenece (Sprint 20, migracion 015). Lo filtra Row Level
  // Security; el codigo lo completa al crear desde el contexto del request.
  @Column({ name: 'taller_id', type: 'uuid' })
  tallerId: string;

  @Column()
  nombre: string;

  @Column({ default: true })
  activa: boolean;

  @CreateDateColumn({ name: 'creado_en' })
  creadoEn: Date;

  @UpdateDateColumn({ name: 'actualizado_en' })
  actualizadoEn: Date;
}
