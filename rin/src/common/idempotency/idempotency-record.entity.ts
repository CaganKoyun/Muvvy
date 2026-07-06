import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Stores the outcome of a mutating request keyed by the client-supplied
 * `Idempotency-Key`. A retry with the same key replays the stored response
 * instead of executing the side effect twice.
 */
@Entity('idempotency_record')
@Index('uq_idem', ['idempotencyKey', 'method', 'path'], { unique: true })
export class IdempotencyRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  idempotencyKey!: string;

  @Column({ type: 'varchar' })
  method!: string;

  @Column({ type: 'varchar' })
  path!: string;

  /** Null while the original request is still in flight. */
  @Column({ type: 'int', nullable: true })
  statusCode!: number | null;

  @Column({ type: 'simple-json', nullable: true })
  responseBody!: unknown;

  @CreateDateColumn()
  createdAt!: Date;
}
