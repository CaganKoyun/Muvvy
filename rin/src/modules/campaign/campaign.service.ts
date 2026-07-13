import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Campaign, Membership } from './entities';
import { CreateCampaignDto, UpsertMembershipDto } from './dto';
import { ConsentService } from '../consent/consent.service';
import { NotificationService } from '../notifications/notification.service';
import { EventBus } from '../../common/events/event-bus';
import { DomainEvent, EventType } from '../../common/events/domain-events';
import { AuditService } from '../../common/audit/audit.service';

@Injectable()
export class CampaignService {
  constructor(
    @InjectRepository(Campaign) private readonly campaigns: Repository<Campaign>,
    @InjectRepository(Membership) private readonly memberships: Repository<Membership>,
    private readonly consent: ConsentService,
    private readonly notifications: NotificationService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
  ) {}

  /**
   * Send a campaign — but ONLY to customers who granted the required permission.
   * This is the consent-safe engagement guarantee: a customer who declined
   * marketing is provably never targeted.
   */
  async createCampaign(merchantId: string, dto: CreateCampaignDto) {
    const requireScope = dto.requireScope ?? 'permission:marketing';
    const grants = await this.consent.activeGrantsForMerchant(merchantId);
    const eligible = grants.filter((g) => g.grantedScopes.includes(requireScope));

    const campaign = await this.campaigns.save(
      this.campaigns.create({
        merchantId,
        title: dto.title,
        body: dto.body ?? null,
        requireScope,
        targetedCount: eligible.length,
        deliveredCount: 0,
      }),
    );

    let delivered = 0;
    for (const g of eligible) {
      const n = await this.notifications.create({
        consumerId: g.consumerId,
        merchantId,
        type: 'campaign',
        title: dto.title,
        body: dto.body,
        meta: { campaignId: campaign.id },
      });
      if (n) delivered++;
    }
    campaign.deliveredCount = delivered;
    await this.campaigns.save(campaign);

    await this.audit.record({
      actorType: 'merchant',
      actorId: merchantId,
      merchantId,
      action: 'campaign.created',
      resourceType: 'campaign',
      resourceId: campaign.id,
      metadata: { requireScope, totalMembers: grants.length, targeted: eligible.length, delivered },
    });
    this.publish(EventType.CampaignCreated, merchantId, {
      campaignId: campaign.id,
      targeted: eligible.length,
      delivered,
    });

    return {
      campaignId: campaign.id,
      title: campaign.title,
      requireScope,
      totalMembers: grants.length,
      targeted: eligible.length,
      delivered,
      suppressed: grants.length - eligible.length,
    };
  }

  async listCampaigns(merchantId: string) {
    return this.campaigns.find({ where: { merchantId }, order: { createdAt: 'DESC' } });
  }

  // ─── Membership ────────────────────────────────────────────────────────────
  async upsertMembership(merchantId: string, dto: UpsertMembershipDto) {
    const grant = await this.consent.requireActiveGrant(merchantId, dto.grantId);
    let m = await this.memberships.findOne({
      where: { merchantId, consumerId: grant.consumerId },
    });
    if (!m) {
      m = this.memberships.create({ merchantId, consumerId: grant.consumerId, tier: 'standard', points: 0 });
    }
    if (dto.tier) m.tier = dto.tier;
    if (dto.addPoints) m.points = (m.points ?? 0) + dto.addPoints;
    m = await this.memberships.save(m);
    return { membershipId: m.id, tier: m.tier, points: m.points, joinedAt: m.joinedAt };
  }

  async listMembers(merchantId: string) {
    const rows = await this.memberships.find({
      where: { merchantId },
      order: { points: 'DESC' },
    });
    return rows.map((m) => ({
      membershipId: m.id,
      tier: m.tier,
      points: m.points,
      joinedAt: m.joinedAt,
    }));
  }

  async listForConsumer(consumerId: string) {
    return this.memberships.find({ where: { consumerId }, order: { joinedAt: 'DESC' } });
  }

  private publish(type: EventType, merchantId: string, data: Record<string, unknown>): void {
    const event: DomainEvent = {
      id: randomUUID(),
      type,
      occurredAt: new Date().toISOString(),
      merchantId,
      data,
    };
    this.events.publish(event);
  }
}
