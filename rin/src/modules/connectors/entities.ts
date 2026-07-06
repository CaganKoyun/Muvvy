import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type ConnectorKind = 'crm' | 'pos' | 'erp';
export type ConnectorAdapter = 'log' | 'rest';

/**
 * A merchant's outbound integration target — the Integration Gateway's config.
 * Events are normalized and forwarded here so a Salesforce/SAP/Dynamics/custom
 * system stays in sync without RIN knowing its internals.
 */
@Entity('connector')
export class Connector {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  merchantId!: string;

  @Column({ type: 'varchar' })
  kind!: ConnectorKind;

  @Column({ type: 'varchar' })
  adapter!: ConnectorAdapter;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'simple-json', nullable: true })
  config!: Record<string, unknown> | null;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  /** The brand's primary solution — consented customers are routed here first. */
  @Column({ type: 'boolean', default: false })
  isPrimary!: boolean;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('connector_sync_log')
export class ConnectorSyncLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  connectorId!: string;

  @Index()
  @Column({ type: 'varchar' })
  merchantId!: string;

  @Column({ type: 'varchar' })
  operation!: string;

  @Column({ type: 'simple-json' })
  record!: unknown;

  @Column({ type: 'varchar', default: 'delivered' })
  status!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
