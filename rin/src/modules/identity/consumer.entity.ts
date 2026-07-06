import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A Spark identity — the "one identity, every store" principal. Email/password
 * is the credential modelled here; social logins (Apple/Google), phone OTP and
 * passkeys all attach to this same row in later phases without changing its
 * meaning: one human, one Spark identity, reused across every merchant.
 */
@Entity('consumer')
export class Consumer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar' })
  email!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar' })
  passwordHash!: string;

  @Column({ type: 'varchar', default: 'active' })
  status!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
