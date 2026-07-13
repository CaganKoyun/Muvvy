import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** OAuth2 client credentials for a merchant's server-to-server API access. */
@Entity('merchant_credential')
export class MerchantCredential {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  merchantId!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar' })
  clientId!: string;

  /** bcrypt hash — the plaintext secret is shown exactly once, at creation. */
  @Column({ type: 'varchar' })
  clientSecretHash!: string;

  @Column({ type: 'varchar', default: 'active' })
  status!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
