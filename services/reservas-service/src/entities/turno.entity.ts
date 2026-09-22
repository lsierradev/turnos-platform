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

// Postgres representa un tsrange como "[2024-01-01 10:00:00+00,2024-01-01 11:00:00+00)".
// TypeORM no tiene un ColumnType nativo para range types, asi que se mapea
// como texto y se convierte a/desde { inicio, fin } aca. Sin una Postgres
// real para probar contra el operador EXCLUDE USING gist, este transformer
// se valida en Sprint 3 cuando se construya el endpoint de reservas.
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

@Entity('turnos')
export class Turno {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'bahia_id' })
  bahiaId: string;

  @Column({ name: 'servicio_id', nullable: true })
  servicioId?: string;

  @Column({ name: 'usuario_id', nullable: true })
  usuarioId?: string;

  @Column({
    name: 'rango_tiempo',
    type: 'tsrange' as 'text',
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
