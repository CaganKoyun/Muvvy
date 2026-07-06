import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type DeliveryStatus = 'pending' | 'success' | 'failed';

/** Audit + retry record for a single event → endpoint delivery attempt chain. */
@Entity('webhook_delivery')
export class WebhookDelivery {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  merchantId!: string;

  @Column({ type: 'varchar' })
  endpointId!: string;

  @Index()
  @Column({ type: 'varchar' })
  eventId!: string;

  @Column({ type: 'varchar' })
  eventType!: string;

  @Column({ type: 'simple-json' })
  payload!: unknown;

  @Column({ type: 'varchar', default: 'pending' })
  status!: DeliveryStatus;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'int', nullable: true })
  responseStatus!: number | null;

  @Column({ type: 'varchar', nullable: true })
  lastError!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
