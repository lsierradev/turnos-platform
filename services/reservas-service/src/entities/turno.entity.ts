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

  // Igual que usuarioId: el tecnico es un Usuario, pero esa entidad
  // pertenece a usuarios-service, asi que aca solo vive el id, sin relacion
  // ORM. Nullable en la DB (ver 006_add_tecnico_a_turnos.sql); obligatorio a
  // nivel de aplicacion via CreateAppointmentDto.
  @Column({ name: 'tecnico_id', nullable: true })
  tecnicoId?: string;

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
