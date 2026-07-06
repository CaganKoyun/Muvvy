import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DateTimeTransformer } from '../../common/orm/datetime.transformer';

export type IdentityRequestStatus = 'pending' | 'approved' | 'denied' | 'expired';

/**
 * A single "Continue with Spark" handshake attempt — created by the merchant
 * (the QR the cashier shows), resolved by the customer. Analogous to an OAuth
 * authorization request.
 */
@Entity('identity_request')
export class IdentityRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  merchantId!: string;

  /** Opaque token embedded in the QR; how the customer looks the request up. */
  @Index({ unique: true })
  @Column({ type: 'varchar' })
  requestToken!: string;

  /** Scopes the merchant asked for on this request. */
  @Column({ type: 'simple-array' })
  requestedScopes!: string[];

  /** Snapshot of which of those were required (customer must grant to proceed). */
  @Column({ type: 'simple-array' })
  requiredScopes!: string[];

  @Column({ type: 'varchar', default: 'pending' })
  status!: IdentityRequestStatus;

  /** Set when a customer resolves the request. */
  @Column({ type: 'varchar', nullable: true })
  consumerId!: string | null;

  @Column({ type: 'simple-array', nullable: true })
  grantedScopes!: string[] | null;

  /** Optional merchant-side reference (e.g. POS transaction id). */
  @Column({ type: 'varchar', nullable: true })
  reference!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'varchar', transformer: DateTimeTransformer })
  expiresAt!: Date;

  @Column({ type: 'varchar', nullable: true, transformer: DateTimeTransformer })
  decidedAt!: Date | null;
}
