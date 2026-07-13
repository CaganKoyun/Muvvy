import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * A merchant's registered webhook sink — where CustomerCreated/ConsentChanged
 * events are pushed so their CRM stays in sync without polling.
 */
@Entity('webhook_endpoint')
export class WebhookEndpoint {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  merchantId!: string;

  @Column({ type: 'varchar' })
  url!: string;

  /** HMAC-SHA256 signing secret (shown once at registration). */
  @Column({ type: 'varchar' })
  secret!: string;

  /** Subscribed event types, or `['*']` for all. */
  @Column({ type: 'simple-array' })
  events!: string[];

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn()
  createdAt!: Date;
}
