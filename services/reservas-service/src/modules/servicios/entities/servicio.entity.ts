import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { TarifaIva } from '../../../common/precios.util';

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

  // Sprint 21: valor BASE en centavos enteros (bigint; pg lo devuelve
  // como string, de ahi el transformer). El IVA y el total se calculan con
  // la configuracion fiscal del taller (common/precios.util.ts).
  @Column({
    name: 'precio_base_centavos',
    type: 'bigint',
    transformer: {
      to: (v: number) => v,
      from: (v: string | null) => (v === null ? null : Number(v)),
    },
  })
  precioBaseCentavos: number;

  @Column({ name: 'tarifa_iva', type: 'smallint', default: 19 })
  tarifaIva: TarifaIva;

  // Politica de cancelacion (Sprint 21): los servicios de alto impacto
  // piden un anticipo del 15-20% al reservar (se cobra en Sprint 24).
  @Column({ name: 'requiere_anticipo', default: false })
  requiereAnticipo: boolean;

  @Column({ name: 'porcentaje_anticipo', type: 'smallint', nullable: true })
  porcentajeAnticipo: number | null;

  // Termino de garantia en dias (Sprint 22, Decreto 735 de 2013); va
  // impreso en la orden de trabajo. null: no definido, rige la garantia
  // legal.
  @Column({ name: 'garantia_dias', type: 'smallint', nullable: true })
  garantiaDias: number | null;

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'creado_en' })
  creadoEn: Date;

  @UpdateDateColumn({ name: 'actualizado_en' })
  actualizadoEn: Date;
}
