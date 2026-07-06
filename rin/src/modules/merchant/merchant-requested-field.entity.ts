import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One row per scope a merchant asks for — the merchant's Consent Engine config.
 * `required=true` means the customer must grant it to complete the handshake;
 * optional scopes can be declined without blocking onboarding.
 */
@Entity('merchant_requested_field')
@Index('uq_merchant_scope', ['merchantId', 'scopeKey'], { unique: true })
export class MerchantRequestedField {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  merchantId!: string;

  @Column({ type: 'varchar' })
  scopeKey!: string;

  @Column({ type: 'boolean', default: false })
  required!: boolean;
}
