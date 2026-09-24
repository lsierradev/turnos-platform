import { encryptedColumnTransformer } from '@turnos-platform/crypto';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum RolUsuario {
  ADMIN = 'admin',
  CLIENTE = 'cliente',
  TECNICO = 'tecnico',
}

@Entity('usuarios')
export class Usuario {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ name: 'password_hash' })
  passwordHash: string;

  @Column()
  nombre: string;

  @Column({ type: 'enum', enum: RolUsuario, default: RolUsuario.CLIENTE })
  rol: RolUsuario;

  // El `type` explicito NO es decorativo: sin el, TypeORM deduce el tipo de
  // columna del metadato que emite TypeScript, y para una union como
  // `string | null` ese metadato es `Object`. TypeORM no sabe mapear Object a
  // Postgres y aborta en DataSource.initialize() con
  // DataTypeNotSupportedError -- o sea que el servicio NO ARRANCA, no es que
  // falle una consulta. Los tests unitarios no lo ven porque mockean el
  // DataSource; lo detecta solo un test que conecte de verdad.
  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedColumnTransformer,
  })
  telefono?: string | null;

  @CreateDateColumn({ name: 'creado_en' })
  creadoEn: Date;

  @UpdateDateColumn({ name: 'actualizado_en' })
  actualizadoEn: Date;
}
