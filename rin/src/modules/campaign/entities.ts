import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('campaign')
export class Campaign {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  merchantId!: string;

  @Column({ type: 'varchar' })
  title!: string;

  @Column({ type: 'varchar', nullable: true })
  body!: string | null;

  /** Consent scope a customer must have granted to be eligible (consent-safe). */
  @Column({ type: 'varchar', default: 'permission:marketing' })
  requireScope!: string;

  @Column({ type: 'int', default: 0 })
  targetedCount!: number;

  @Column({ type: 'int', default: 0 })
  deliveredCount!: number;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('membership')
@Index('uq_membership', ['merchantId', 'consumerId'], { unique: true })
export class Membership {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  merchantId!: string;

  @Index()
  @Column({ type: 'varchar' })
  consumerId!: string;

  @Column({ type: 'varchar', default: 'standard' })
  tier!: string;

  @Column({ type: 'int', default: 0 })
  points!: number;

  @CreateDateColumn()
  joinedAt!: Date;
}
