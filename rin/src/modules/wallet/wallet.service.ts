import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Receipt, ReceiptItem, Warranty, WalletItem } from './entities';
import { UploadReceiptDto, IssueWalletItemDto } from './dto';
import { ConsentService } from '../consent/consent.service';
import { EventBus } from '../../common/events/event-bus';
import { DomainEvent, EventType } from '../../common/events/domain-events';
import { AuditService } from '../../common/audit/audit.service';

@Injectable()
export class WalletService {
  constructor(
    @InjectRepository(Receipt) private readonly receipts: Repository<Receipt>,
    @InjectRepository(ReceiptItem) private readonly items: Repository<ReceiptItem>,
    @InjectRepository(Warranty) private readonly warranties: Repository<Warranty>,
    @InjectRepository(WalletItem) private readonly wallet: Repository<WalletItem>,
    private readonly consent: ConsentService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
  ) {}

  // ─── Merchant: push a digital receipt (POS → Receipt API → Wallet) ─────────
  async uploadReceipt(merchantId: string, dto: UploadReceiptDto) {
    const grant = await this.consent.requireActiveGrant(merchantId, dto.grantId);
    const purchasedAt = new Date(dto.purchasedAt);
    const totalMinor = dto.items.reduce((sum, i) => sum + i.unitPriceMinor * i.quantity, 0);

    const receipt = await this.receipts.save(
      this.receipts.create({
        merchantId,
        consumerId: grant.consumerId,
        externalId: dto.externalId ?? null,
        storeName: dto.storeName ?? null,
        currency: dto.currency ?? 'TRY',
        totalMinor,
        purchasedAt,
      }),
    );

    const savedItems = await this.items.save(
      dto.items.map((i) =>
        this.items.create({
          receiptId: receipt.id,
          name: i.name,
          sku: i.sku ?? null,
          quantity: i.quantity,
          unitPriceMinor: i.unitPriceMinor,
          warrantyMonths: i.warrantyMonths ?? null,
          returnDays: i.returnDays ?? null,
        }),
      ),
    );

    // Warranties are auto-attached for items that carry one.
    const warranties = savedItems
      .filter((i) => i.warrantyMonths && i.warrantyMonths > 0)
      .map((i) =>
        this.warranties.create({
          consumerId: grant.consumerId,
          receiptId: receipt.id,
          itemName: i.name,
          months: i.warrantyMonths as number,
          startsAt: purchasedAt,
          expiresAt: addMonths(purchasedAt, i.warrantyMonths as number),
        }),
      );
    const savedWarranties = warranties.length ? await this.warranties.save(warranties) : [];

    await this.audit.record({
      actorType: 'merchant',
      actorId: merchantId,
      merchantId,
      consumerId: grant.consumerId,
      action: 'receipt.uploaded',
      resourceType: 'receipt',
      resourceId: receipt.id,
      metadata: { totalMinor, items: savedItems.length, warranties: savedWarranties.length },
    });

    this.publish(EventType.ReceiptUploaded, merchantId, grant.consumerId, {
      receiptId: receipt.id,
      grantId: grant.id,
      totalMinor,
      currency: receipt.currency,
      itemCount: savedItems.length,
      warranties: savedWarranties.length,
    });

    return this.receiptView(receipt, savedItems, savedWarranties);
  }

  // ─── Merchant: issue a coupon / gift card / loyalty card ───────────────────
  async issueWalletItem(merchantId: string, dto: IssueWalletItemDto) {
    const grant = await this.consent.requireActiveGrant(merchantId, dto.grantId);
    const item = await this.wallet.save(
      this.wallet.create({
        consumerId: grant.consumerId,
        merchantId,
        type: dto.type,
        title: dto.title,
        code: dto.code ?? null,
        balanceMinor: dto.balanceMinor ?? null,
        currency: dto.currency ?? null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      }),
    );
    this.publish(EventType.WalletItemIssued, merchantId, grant.consumerId, {
      walletItemId: item.id,
      type: item.type,
      title: item.title,
    });
    return item;
  }

  // ─── Consumer: wallet views ────────────────────────────────────────────────
  async listReceipts(consumerId: string) {
    return this.receipts.find({ where: { consumerId }, order: { purchasedAt: 'DESC' } });
  }

  async getReceipt(consumerId: string, id: string) {
    const receipt = await this.receipts.findOne({ where: { id, consumerId } });
    if (!receipt) return null;
    const [items, warranties] = await Promise.all([
      this.items.find({ where: { receiptId: id } }),
      this.warranties.find({ where: { receiptId: id } }),
    ]);
    return this.receiptView(receipt, items, warranties);
  }

  async listWarranties(consumerId: string) {
    return this.warranties.find({ where: { consumerId }, order: { expiresAt: 'ASC' } });
  }

  async listWallet(consumerId: string) {
    const items = await this.wallet.find({
      where: { consumerId },
      order: { createdAt: 'DESC' },
    });
    return {
      giftCards: items.filter((i) => i.type === 'gift_card'),
      coupons: items.filter((i) => i.type === 'coupon'),
      loyaltyCards: items.filter((i) => i.type === 'loyalty_card'),
      membershipCards: items.filter((i) => i.type === 'membership_card'),
    };
  }

  async timeline(consumerId: string) {
    const receipts = await this.receipts.find({
      where: { consumerId },
      order: { purchasedAt: 'DESC' },
    });
    return receipts.map((r) => ({
      receiptId: r.id,
      storeName: r.storeName,
      totalMinor: r.totalMinor,
      currency: r.currency,
      purchasedAt: r.purchasedAt,
    }));
  }

  /** Warranties expiring within `withinDays` — feeds warranty-expiry notifications. */
  async expiringWarranties(consumerId: string, withinDays = 30) {
    // expiresAt is stored as an ISO string (portable), which sorts
    // chronologically — so compare against an ISO cutoff, not a Date object.
    const cutoff = new Date(Date.now() + withinDays * 86_400_000).toISOString();
    return this.warranties.find({
      where: { consumerId, expiresAt: LessThanOrEqual(cutoff as unknown as Date) },
      order: { expiresAt: 'ASC' },
    });
  }

  private receiptView(receipt: Receipt, items: ReceiptItem[], warranties: Warranty[]) {
    return {
      id: receipt.id,
      merchantId: receipt.merchantId,
      storeName: receipt.storeName,
      currency: receipt.currency,
      totalMinor: receipt.totalMinor,
      purchasedAt: receipt.purchasedAt,
      items: items.map((i) => ({
        name: i.name,
        sku: i.sku,
        quantity: i.quantity,
        unitPriceMinor: i.unitPriceMinor,
        returnByDate: i.returnDays ? addDays(receipt.purchasedAt, i.returnDays) : null,
        warrantyMonths: i.warrantyMonths,
      })),
      warranties: warranties.map((w) => ({
        itemName: w.itemName,
        months: w.months,
        expiresAt: w.expiresAt,
      })),
    };
  }

  private publish(
    type: EventType,
    merchantId: string,
    consumerId: string,
    data: Record<string, unknown>,
  ): void {
    const event: DomainEvent = {
      id: randomUUID(),
      type,
      occurredAt: new Date().toISOString(),
      merchantId,
      consumerId,
      data,
    };
    this.events.publish(event);
  }
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}
function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}
