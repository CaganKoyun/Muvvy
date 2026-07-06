import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DateTimeTransformer } from '../../common/orm/datetime.transformer';

/**
 * Money is stored as integer minor units (e.g. kuruş/cents) for exact,
 * driver-portable arithmetic — no float or driver-specific DECIMAL.
 */

@Entity('receipt')
export class Receipt {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  merchantId!: string;

  @Index()
  @Column({ type: 'varchar' })
  consumerId!: string;

  /** Merchant-side receipt id (POS transaction), for idempotent re-upload. */
  @Column({ type: 'varchar', nullable: true })
  externalId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  storeName!: string | null;

  @Column({ type: 'varchar', default: 'TRY' })
  currency!: string;

  @Column({ type: 'int', default: 0 })
  totalMinor!: number;

  @Column({ type: 'varchar', transformer: DateTimeTransformer })
  purchasedAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('receipt_item')
export class ReceiptItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  receiptId!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'varchar', nullable: true })
  sku!: string | null;

  @Column({ type: 'int', default: 1 })
  quantity!: number;

  @Column({ type: 'int', default: 0 })
  unitPriceMinor!: number;

  /** If set, a warranty is auto-created for this item. */
  @Column({ type: 'int', nullable: true })
  warrantyMonths!: number | null;

  /** If set, the return window is surfaced to the customer. */
  @Column({ type: 'int', nullable: true })
  returnDays!: number | null;
}

@Entity('warranty')
export class Warranty {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  consumerId!: string;

  @Column({ type: 'varchar' })
  receiptId!: string;

  @Column({ type: 'varchar' })
  itemName!: string;

  @Column({ type: 'int' })
  months!: number;

  @Column({ type: 'varchar', transformer: DateTimeTransformer })
  startsAt!: Date;

  @Index()
  @Column({ type: 'varchar', transformer: DateTimeTransformer })
  expiresAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;
}

export type WalletItemType = 'gift_card' | 'coupon' | 'loyalty_card' | 'membership_card';

@Entity('wallet_item')
export class WalletItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  consumerId!: string;

  @Column({ type: 'varchar', nullable: true })
  merchantId!: string | null;

  @Column({ type: 'varchar' })
  type!: WalletItemType;

  @Column({ type: 'varchar' })
  title!: string;

  @Column({ type: 'varchar', nullable: true })
  code!: string | null;

  @Column({ type: 'int', nullable: true })
  balanceMinor!: number | null;

  @Column({ type: 'varchar', nullable: true })
  currency!: string | null;

  @Column({ type: 'varchar', nullable: true, transformer: DateTimeTransformer })
  expiresAt!: Date | null;

  @Column({ type: 'varchar', default: 'active' })
  status!: string;

  @Column({ type: 'simple-json', nullable: true })
  meta!: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt!: Date;
}
