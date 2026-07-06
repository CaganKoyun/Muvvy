import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PublicKeyJwk } from '../../common/webauthn/webauthn';

export type CredentialType = 'passkey' | 'oauth';

/**
 * An additional authentication method attached to a Spark identity. The same
 * `consumer` can carry a password, one or more passkeys, and linked social
 * providers — all resolving to the one identity reused across every store.
 */
@Entity('consumer_credential')
@Index('ix_oauth', ['provider', 'subject'])
export class ConsumerCredential {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  consumerId!: string;

  @Column({ type: 'varchar' })
  type!: CredentialType;

  // ── passkey (WebAuthn) ──
  @Index({ unique: true })
  @Column({ type: 'varchar', nullable: true })
  credentialId!: string | null;

  @Column({ type: 'simple-json', nullable: true })
  publicKeyJwk!: PublicKeyJwk | null;

  @Column({ type: 'int', default: 0 })
  counter!: number;

  // ── social (OIDC) ──
  @Column({ type: 'varchar', nullable: true })
  provider!: string | null;

  @Column({ type: 'varchar', nullable: true })
  subject!: string | null;

  @Column({ type: 'varchar', nullable: true })
  label!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
