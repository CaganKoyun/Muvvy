import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export interface PostalAddress {
  line1?: string;
  city?: string;
  postalCode?: string;
  country?: string;
}

/**
 * The customer-owned profile. This is the single source of the PII a merchant
 * can request through the Consent Engine. The customer owns and edits it once;
 * merchants only ever see the slice they were granted.
 */
@Entity('consumer_profile')
export class ConsumerProfile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar' })
  consumerId!: string;

  @Column({ type: 'varchar', nullable: true })
  firstName!: string | null;

  @Column({ type: 'varchar', nullable: true })
  lastName!: string | null;

  /** ISO date (YYYY-MM-DD). */
  @Column({ type: 'varchar', nullable: true })
  birthday!: string | null;

  @Column({ type: 'varchar', nullable: true })
  gender!: string | null;

  @Column({ type: 'simple-json', nullable: true })
  address!: PostalAddress | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
