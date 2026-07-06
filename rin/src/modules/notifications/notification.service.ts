import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification, NotificationType } from './notification.entity';
import { WalletService } from '../wallet/wallet.service';

export interface CreateNotificationInput {
  consumerId: string;
  type: NotificationType;
  title: string;
  body?: string;
  merchantId?: string;
  dedupeKey?: string;
  meta?: Record<string, unknown>;
}

@Injectable()
export class NotificationService {
  constructor(
    @InjectRepository(Notification)
    private readonly repo: Repository<Notification>,
    private readonly wallet: WalletService,
  ) {}

  /** Create a notification, honouring the dedupe key (no duplicates). */
  async create(input: CreateNotificationInput): Promise<Notification | null> {
    if (input.dedupeKey) {
      const existing = await this.repo.findOne({
        where: { consumerId: input.consumerId, dedupeKey: input.dedupeKey },
      });
      if (existing) return null;
    }
    return this.repo.save(
      this.repo.create({
        consumerId: input.consumerId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        merchantId: input.merchantId ?? null,
        dedupeKey: input.dedupeKey ?? null,
        meta: input.meta ?? null,
      }),
    );
  }

  async list(consumerId: string) {
    const items = await this.repo.find({
      where: { consumerId },
      order: { createdAt: 'DESC' },
      take: 200,
    });
    const unread = items.filter((n) => !n.read).length;
    return { unread, items };
  }

  async markRead(consumerId: string, id: string) {
    await this.repo.update({ id, consumerId }, { read: true });
    return { id, read: true };
  }

  async markAllRead(consumerId: string) {
    await this.repo.update({ consumerId, read: false }, { read: true });
    return { ok: true };
  }

  /**
   * Generate "your warranty is expiring" reminders for the customer. In
   * production a scheduled job runs this fleet-wide; here it is on-demand.
   */
  async refreshWarrantyReminders(consumerId: string, withinDays = 30) {
    const expiring = await this.wallet.expiringWarranties(consumerId, withinDays);
    let created = 0;
    for (const w of expiring) {
      const n = await this.create({
        consumerId,
        type: 'warranty_expiry',
        title: `Warranty ending soon: ${w.itemName}`,
        body: `Your ${w.months}-month warranty for "${w.itemName}" expires on ${w.expiresAt.toISOString().slice(0, 10)}.`,
        dedupeKey: `warranty:${w.id}`,
        meta: { warrantyId: w.id, expiresAt: w.expiresAt },
      });
      if (n) created++;
    }
    return { scanned: expiring.length, created };
  }
}
