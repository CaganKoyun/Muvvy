import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DateTimeTransformer } from '../../common/orm/datetime.transformer';

/**
 * Short-lived WebAuthn challenge. Persisted (not in-memory) so the ceremony
 * works across horizontally-scaled instances. `subjectKey` is the consumer id
 * for registration, or the email for a login attempt.
 */
@Entity('webauthn_challenge')
export class WebAuthnChallenge {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  subjectKey!: string;

  @Column({ type: 'varchar' })
  kind!: 'register' | 'login';

  @Column({ type: 'varchar' })
  challenge!: string;

  @Column({ type: 'varchar', transformer: DateTimeTransformer })
  expiresAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;
}
