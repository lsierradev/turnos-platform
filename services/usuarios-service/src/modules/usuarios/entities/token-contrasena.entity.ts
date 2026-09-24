import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type MotivoToken = 'alta' | 'olvido';

/** Enlace de un solo uso para definir la contrasena (migracion 013). */
@Entity('tokens_contrasena')
export class TokenContrasena {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'usuario_id', type: 'uuid' })
  usuarioId: string;

  /** SHA-256 hex del token. El token en claro solo viaja en el correo. */
  @Column({ name: 'token_hash', type: 'text' })
  tokenHash: string;

  @Column({ type: 'text' })
  motivo: MotivoToken;

  @Column({ name: 'expira_en', type: 'timestamptz' })
  expiraEn: Date;

  // Tipo explicito: con `Date | null` TypeScript emite Object como metadato
  // y TypeORM no arranca (ver Usuario.telefono).
  @Column({ name: 'usado_en', type: 'timestamptz', nullable: true })
  usadoEn: Date | null;

  @CreateDateColumn({ name: 'creado_en' })
  creadoEn: Date;
}
