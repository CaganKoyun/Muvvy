import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type NotificationType =
  | 'campaign'
  | 'coupon'
  | 'store_message'
  | 'warranty_expiry'
  | 'system';

/** A single item in the customer's Notification Center. */
@Entity('notification')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  consumerId!: string;

  @Column({ type: 'varchar', nullable: true })
  merchantId!: string | null;

  @Column({ type: 'varchar' })
  type!: NotificationType;

  @Column({ type: 'varchar' })
  title!: string;

  @Column({ type: 'varchar', nullable: true })
  body!: string | null;

  /** De-dupe key so re-scans (e.g. warranty expiry) don't spam. */
  @Index()
  @Column({ type: 'varchar', nullable: true })
  dedupeKey!: string | null;

  @Column({ type: 'boolean', default: false })
  read!: boolean;

  @Column({ type: 'simple-json', nullable: true })
  meta!: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt!: Date;
}
