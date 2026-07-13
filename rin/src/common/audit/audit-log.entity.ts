import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type ActorType = 'consumer' | 'merchant' | 'system';

/**
 * Append-only audit trail. Every consent decision, disclosure and admin action
 * lands here — the evidentiary backbone for KVKK/GDPR data-subject requests and
 * the Transparency Center.
 */
@Entity('audit_log')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  actorType!: ActorType;

  @Column({ type: 'varchar', nullable: true })
  actorId!: string | null;

  @Index()
  @Column({ type: 'varchar' })
  action!: string;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  merchantId!: string | null;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  consumerId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  resourceType!: string | null;

  @Column({ type: 'varchar', nullable: true })
  resourceId!: string | null;

  @Column({ type: 'simple-json', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ type: 'varchar', nullable: true })
  ip!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
