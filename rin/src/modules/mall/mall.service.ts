import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Mall, MallStore } from './entities';
import { ConsentService } from '../consent/consent.service';
import { MerchantService } from '../merchant/merchant.service';
import { CampaignService } from '../campaign/campaign.service';

@Injectable()
export class MallService {
  constructor(
    @InjectRepository(Mall) private readonly malls: Repository<Mall>,
    @InjectRepository(MallStore) private readonly stores: Repository<MallStore>,
    private readonly consent: ConsentService,
    private readonly merchants: MerchantService,
    private readonly campaigns: CampaignService,
  ) {}

  // ─── Provisioning (admin/seed in this slice) ──────────────────────────────
  async createMall(name: string, slug: string, city?: string): Promise<Mall> {
    if (await this.malls.findOne({ where: { slug } })) {
      throw new ConflictException(`Mall slug '${slug}' already in use.`);
    }
    return this.malls.save(this.malls.create({ name, slug, city: city ?? null }));
  }

  async addStore(mallId: string, merchantId: string): Promise<MallStore> {
    const existing = await this.stores.findOne({ where: { mallId, merchantId } });
    if (existing) return existing;
    return this.stores.save(this.stores.create({ mallId, merchantId }));
  }

  // ─── Merchant plane ────────────────────────────────────────────────────────
  async mallsForMerchant(merchantId: string) {
    const rows = await this.stores.find({ where: { merchantId } });
    if (!rows.length) return [];
    const malls = await this.malls.find({ where: { id: In(rows.map((r) => r.mallId)) } });
    return malls;
  }

  async assertMerchantInMall(mallId: string, merchantId: string): Promise<void> {
    const link = await this.stores.findOne({ where: { mallId, merchantId } });
    if (!link) throw new ForbiddenException('Merchant is not a member of this mall.');
  }

  /**
   * Mall-wide identity dashboard. "Visitor identity rate" here is the number of
   * distinct Spark identities that have an active grant at any member store —
   * i.e. how many mall shoppers are known across the participating retailers.
   * (Anonymous foot-traffic heatmaps need location data — out of this slice.)
   */
  async dashboard(mallId: string) {
    const mall = await this.malls.findOne({ where: { id: mallId } });
    if (!mall) throw new NotFoundException('Mall not found.');

    const storeLinks = await this.stores.find({ where: { mallId } });
    const distinctConsumers = new Set<string>();
    let totalMemberships = 0;
    let campaignsSent = 0;
    let campaignReach = 0;

    const perStore = [];
    for (const link of storeLinks) {
      const merchant = await this.merchants.findById(link.merchantId);
      const grants = await this.consent.activeGrantsForMerchant(link.merchantId);
      grants.forEach((g) => distinctConsumers.add(g.consumerId));
      totalMemberships += grants.length;

      const campaigns = await this.campaigns.listCampaigns(link.merchantId);
      campaignsSent += campaigns.length;
      campaignReach += campaigns.reduce((s, c) => s + c.deliveredCount, 0);

      perStore.push({
        merchantId: merchant.id,
        name: merchant.name,
        category: merchant.category,
        identifiedCustomers: grants.length,
      });
    }

    return {
      mall: { id: mall.id, name: mall.name, city: mall.city },
      storeParticipation: storeLinks.length,
      identifiedShoppers: distinctConsumers.size,
      totalStoreMemberships: totalMemberships,
      crossStoreShoppers: totalMemberships - distinctConsumers.size, // identities shared across stores
      campaignsSent,
      campaignReach,
      stores: perStore.sort((a, b) => b.identifiedCustomers - a.identifiedCustomers),
    };
  }

  // ─── Consumer plane ─────────────────────────────────────────────────────────
  async mallsForConsumer(consumerId: string) {
    // Malls that contain at least one store the consumer has an active grant with.
    const grants = await this.consent.grantsForConsumerActiveMerchantIds(consumerId);
    if (!grants.length) return [];
    const links = await this.stores.find({ where: { merchantId: In(grants) } });
    if (!links.length) return [];
    const malls = await this.malls.find({ where: { id: In(links.map((l) => l.mallId)) } });
    return malls.map((m) => ({ id: m.id, name: m.name, city: m.city }));
  }
}
