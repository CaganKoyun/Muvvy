import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DateTimeTransformer } from '../../common/orm/datetime.transformer';

export type ConsentGrantStatus = 'active' | 'revoked';

/**
 * The durable consent relationship between one customer and one merchant — the
 * standing "this store may use these fields" record. Revocable at any time; a
 * merchant sees a customer only through an active grant.
 */
@Entity('consent_grant')
@Index('uq_active_grant', ['merchantId', 'consumerId'], { unique: true })
export class ConsentGrant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  merchantId!: string;

  @Index()
  @Column({ type: 'varchar' })
  consumerId!: string;

  @Column({ type: 'simple-array' })
  grantedScopes!: string[];

  @Column({ type: 'varchar', default: 'active' })
  status!: ConsentGrantStatus;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: 'varchar', nullable: true, transformer: DateTimeTransformer })
  revokedAt!: Date | null;
}
