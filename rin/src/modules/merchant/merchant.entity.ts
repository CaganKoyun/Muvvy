import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * A participating retail **brand** — the tenant boundary of the whole platform.
 * A brand has many branches (şube) and carries the branding shown to shoppers on
 * the consent screen.
 */
@Entity('merchant')
export class Merchant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar' })
  slug!: string;

  @Column({ type: 'varchar', nullable: true })
  category!: string | null;

  // ── Branding (rendered on the branded consent screen) ──
  @Column({ type: 'varchar', nullable: true })
  displayName!: string | null;

  @Column({ type: 'varchar', nullable: true })
  logoUrl!: string | null;

  @Column({ type: 'varchar', nullable: true })
  primaryColor!: string | null;

  /** Where the shopper is sent after consent (the brand's own app/loyalty). */
  @Column({ type: 'varchar', nullable: true })
  postConsentRedirectUrl!: string | null;

  @Column({ type: 'varchar', default: 'active' })
  status!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
