import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** A branch (şube) of a brand — the physical store that shows the QR. */
@Entity('branch')
@Index('uq_branch_code', ['merchantId', 'code'], { unique: true })
export class Branch {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  merchantId!: string;

  @Column({ type: 'varchar' })
  name!: string;

  /** Short store code, unique within the brand (e.g. "AKASYA"). */
  @Column({ type: 'varchar' })
  code!: string;

  @Column({ type: 'varchar', nullable: true })
  city!: string | null;

  @Column({ type: 'varchar', default: 'active' })
  status!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
