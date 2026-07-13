import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('mall')
export class Mall {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar' })
  slug!: string;

  @Column({ type: 'varchar', nullable: true })
  city!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}

/** A merchant participating in a mall (many-to-many via this join row). */
@Entity('mall_store')
@Index('uq_mall_store', ['mallId', 'merchantId'], { unique: true })
export class MallStore {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  mallId!: string;

  @Index()
  @Column({ type: 'varchar' })
  merchantId!: string;

  @CreateDateColumn()
  joinedAt!: Date;
}
