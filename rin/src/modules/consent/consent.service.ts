import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'crypto';
import { IdentityRequest } from './identity-request.entity';
import { ConsentGrant } from './consent-grant.entity';
import { CreateIdentityRequestDto, ApproveRequestDto } from './dto';
import { MerchantService } from '../merchant/merchant.service';
import { ProfileService } from '../profile/profile.service';
import { EventBus } from '../../common/events/event-bus';
import { DomainEvent, EventType } from '../../common/events/domain-events';
import { AuditService } from '../../common/audit/audit.service';
import { AppConfig } from '../../config/configuration';
import { describeScopes } from '../../common/scopes';

@Injectable()
export class ConsentService {
  private readonly ttlSeconds: number;

  constructor(
    @InjectRepository(IdentityRequest)
    private readonly requests: Repository<IdentityRequest>,
    @InjectRepository(ConsentGrant)
    private readonly grants: Repository<ConsentGrant>,
    private readonly merchants: MerchantService,
    private readonly profiles: ProfileService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.ttlSeconds = config.get('jwt', { infer: true }).identityRequestTtl;
  }

  // ─── Merchant: create the "Continue with Spark" request (the QR) ───────────
  async createRequest(merchantId: string, dto: CreateIdentityRequestDto) {
    const configured = await this.merchants.getRequestedFields(merchantId);
    const requestedScopes = dto.requestedScopes ?? configured.map((f) => f.scopeKey);
    if (requestedScopes.length === 0) {
      throw new BadRequestException(
        'No scopes requested and merchant has no Consent Engine config.',
      );
    }
    const requiredScopes =
      dto.requiredScopes ?? configured.filter((f) => f.required).map((f) => f.scopeKey);

    const missingRequired = requiredScopes.filter((s) => !requestedScopes.includes(s));
    if (missingRequired.length) {
      throw new BadRequestException(
        `Required scopes must be a subset of requested: ${missingRequired.join(', ')}`,
      );
    }

    // The branch (şube) that shows the QR, validated against the brand.
    if (dto.branchId) await this.merchants.requireBranch(merchantId, dto.branchId);

    const request = await this.requests.save(
      this.requests.create({
        merchantId,
        branchId: dto.branchId ?? null,
        requestToken: `rt_${randomBytes(18).toString('hex')}`,
        requestedScopes,
        requiredScopes,
        reference: dto.reference ?? null,
        status: 'pending',
        expiresAt: new Date(Date.now() + this.ttlSeconds * 1000),
      }),
    );

    await this.audit.record({
      actorType: 'merchant',
      actorId: merchantId,
      merchantId,
      action: 'identity_request.created',
      resourceType: 'identity_request',
      resourceId: request.id,
      metadata: { requestedScopes, requiredScopes },
    });

    return this.merchantRequestView(request);
  }

  // ─── Consumer: view a pending request ──────────────────────────────────────
  async viewRequestForConsumer(token: string) {
    const request = await this.loadByTokenFresh(token);
    const merchant = await this.merchants.findById(request.merchantId);
    const branch = request.branchId
      ? await this.merchants.findBranchById(request.branchId)
      : null;
    return {
      requestId: request.id,
      requestToken: request.requestToken,
      status: request.status,
      // Everything the branded consent screen renders:
      brand: this.merchants.branding(merchant),
      branch: branch ? { id: branch.id, name: branch.name, code: branch.code, city: branch.city } : null,
      merchant: {
        id: merchant.id,
        name: merchant.name,
        slug: merchant.slug,
        category: merchant.category,
      },
      requested: describeScopes(request.requestedScopes),
      requiredScopes: request.requiredScopes,
      reference: request.reference,
      expiresAt: request.expiresAt,
    };
  }

  // ─── Consumer: approve with granular scopes ────────────────────────────────
  async approve(consumerId: string, token: string, dto: ApproveRequestDto) {
    const request = await this.loadByTokenFresh(token);
    if (request.status === 'expired') {
      throw new GoneException('This request has expired. Ask the store to show a new QR.');
    }
    if (request.status !== 'pending') {
      throw new BadRequestException(`Request already ${request.status}.`);
    }

    const granted = unique(dto.grantedScopes);
    const notRequested = granted.filter((s) => !request.requestedScopes.includes(s));
    if (notRequested.length) {
      throw new BadRequestException(`Scopes not requested by merchant: ${notRequested.join(', ')}`);
    }
    const missingRequired = request.requiredScopes.filter((s) => !granted.includes(s));
    if (missingRequired.length) {
      throw new BadRequestException(
        `These scopes are required to continue: ${missingRequired.join(', ')}`,
      );
    }

    // Upsert the durable grant (one row per merchant+consumer).
    let grant = await this.grants.findOne({
      where: { merchantId: request.merchantId, consumerId },
    });
    const isNew = !grant;
    if (!grant) {
      grant = this.grants.create({
        merchantId: request.merchantId,
        consumerId,
        grantedScopes: granted,
        status: 'active',
      });
    } else {
      grant.grantedScopes = granted;
      grant.status = 'active';
      grant.revokedAt = null;
    }
    grant = await this.grants.save(grant);

    request.status = 'approved';
    request.consumerId = consumerId;
    request.grantedScopes = granted;
    request.decidedAt = new Date();
    await this.requests.save(request);

    await this.audit.record({
      actorType: 'consumer',
      actorId: consumerId,
      consumerId,
      merchantId: request.merchantId,
      action: isNew ? 'consent.granted' : 'consent.updated',
      resourceType: 'consent_grant',
      resourceId: grant.id,
      metadata: { grantedScopes: granted },
    });

    // Disclosed snapshot delivered to the merchant CRM via webhook.
    const disclosed = await this.profiles.resolveDisclosure(consumerId, granted);

    this.publish(EventType.IdentityVerified, request.merchantId, consumerId, {
      grantId: grant.id,
      grantedScopes: granted,
    });
    this.publish(
      isNew ? EventType.CustomerCreated : EventType.CustomerUpdated,
      request.merchantId,
      consumerId,
      { grantId: grant.id, grantedScopes: granted, customer: disclosed },
    );

    const merchant = await this.merchants.findById(request.merchantId);
    return {
      grantId: grant.id,
      status: 'approved',
      grantedScopes: granted,
      brand: this.merchants.branding(merchant),
      // Route the shopper into the brand's own solution (loyalty app, etc.).
      redirect: merchant.postConsentRedirectUrl,
    };
  }

  // ─── Consumer: deny ────────────────────────────────────────────────────────
  async deny(consumerId: string, token: string) {
    const request = await this.loadByTokenFresh(token);
    if (request.status !== 'pending') {
      throw new BadRequestException(`Request already ${request.status}.`);
    }
    request.status = 'denied';
    request.consumerId = consumerId;
    request.decidedAt = new Date();
    await this.requests.save(request);
    await this.audit.record({
      actorType: 'consumer',
      actorId: consumerId,
      consumerId,
      merchantId: request.merchantId,
      action: 'identity_request.denied',
      resourceType: 'identity_request',
      resourceId: request.id,
    });
    return { requestId: request.id, status: 'denied' };
  }

  // ─── Merchant: poll a request / read the resulting customer ────────────────
  async getRequestResultForMerchant(merchantId: string, requestId: string) {
    const request = await this.requests.findOne({ where: { id: requestId } });
    if (!request || request.merchantId !== merchantId) {
      throw new NotFoundException('Identity request not found.');
    }
    await this.refreshExpiry(request);

    if (request.status !== 'approved' || !request.consumerId) {
      return { requestId: request.id, status: request.status };
    }
    const grant = await this.grants.findOne({
      where: { merchantId, consumerId: request.consumerId },
    });
    if (!grant || grant.status !== 'active') {
      return { requestId: request.id, status: 'revoked', grantId: grant?.id };
    }
    const customer = await this.profiles.resolveDisclosure(grant.consumerId, grant.grantedScopes);
    return {
      requestId: request.id,
      status: 'approved',
      grantId: grant.id,
      grantedScopes: grant.grantedScopes,
      customer,
    };
  }

  // ─── Merchant: customer directory (grants) ─────────────────────────────────
  async listCustomers(merchantId: string) {
    const grants = await this.grants.find({
      where: { merchantId },
      order: { createdAt: 'DESC' },
    });
    return grants.map((g) => ({
      grantId: g.id,
      status: g.status,
      grantedScopes: g.grantedScopes,
      memberSince: g.createdAt,
    }));
  }

  /** Resolve an active grant a merchant owns — the merchant's handle to a customer. */
  async requireActiveGrant(merchantId: string, grantId: string): Promise<ConsentGrant> {
    const grant = await this.grants.findOne({ where: { id: grantId, merchantId } });
    if (!grant || grant.status !== 'active') {
      throw new NotFoundException('No active grant for this customer.');
    }
    return grant;
  }

  /** Every active grant for a merchant (used for campaign targeting). */
  async activeGrantsForMerchant(merchantId: string): Promise<ConsentGrant[]> {
    return this.grants.find({ where: { merchantId, status: 'active' } });
  }

  /** Merchant ids the consumer currently has an active grant with. */
  async grantsForConsumerActiveMerchantIds(consumerId: string): Promise<string[]> {
    const rows = await this.grants.find({ where: { consumerId, status: 'active' } });
    return rows.map((g) => g.merchantId);
  }

  async getCustomerForMerchant(merchantId: string, grantId: string) {
    const grant = await this.grants.findOne({ where: { id: grantId, merchantId } });
    if (!grant) throw new NotFoundException('Customer not found.');
    if (grant.status !== 'active') {
      return { grantId: grant.id, status: 'revoked' };
    }
    const customer = await this.profiles.resolveDisclosure(grant.consumerId, grant.grantedScopes);
    return { grantId: grant.id, status: 'active', grantedScopes: grant.grantedScopes, customer };
  }

  // ─── Consumer: Consent Center ──────────────────────────────────────────────
  async listGrantsForConsumer(consumerId: string) {
    const grants = await this.grants.find({
      where: { consumerId },
      order: { updatedAt: 'DESC' },
    });
    const out = [];
    for (const g of grants) {
      const merchant = await this.merchants.findById(g.merchantId);
      out.push({
        grantId: g.id,
        // "Connected brands" — with branding for the consumer app.
        brand: this.merchants.branding(merchant),
        merchant: { id: merchant.id, name: merchant.name, slug: merchant.slug },
        status: g.status,
        grantedScopes: g.grantedScopes,
        grantedDetail: describeScopes(g.grantedScopes),
        since: g.createdAt,
        revokedAt: g.revokedAt,
      });
    }
    return out;
  }

  async revoke(consumerId: string, grantId: string) {
    const grant = await this.grants.findOne({ where: { id: grantId, consumerId } });
    if (!grant) throw new NotFoundException('Grant not found.');
    if (grant.status === 'revoked') {
      return { grantId: grant.id, status: 'revoked', alreadyRevoked: true };
    }
    grant.status = 'revoked';
    grant.revokedAt = new Date();
    await this.grants.save(grant);

    await this.audit.record({
      actorType: 'consumer',
      actorId: consumerId,
      consumerId,
      merchantId: grant.merchantId,
      action: 'consent.revoked',
      resourceType: 'consent_grant',
      resourceId: grant.id,
    });
    this.publish(EventType.ConsentChanged, grant.merchantId, consumerId, {
      grantId: grant.id,
      status: 'revoked',
    });
    return { grantId: grant.id, status: 'revoked' };
  }

  // ─── Merchant dashboard analytics ──────────────────────────────────────────
  async dashboard(merchantId: string) {
    const [all, approved, denied] = await Promise.all([
      this.requests.count({ where: { merchantId } }),
      this.requests.find({ where: { merchantId, status: 'approved' } }),
      this.requests.count({ where: { merchantId, status: 'denied' } }),
    ]);
    const activeGrants = await this.grants.find({ where: { merchantId, status: 'active' } });

    const decided = approved.length + denied;
    const consentRate = decided ? approved.length / decided : 0;

    const durations = approved
      .filter((r) => r.decidedAt)
      .map((r) => (r.decidedAt as Date).getTime() - r.createdAt.getTime())
      .filter((ms) => ms >= 0);
    const avgCheckoutSeconds = durations.length
      ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length / 1000) * 100) / 100
      : null;

    const scopeCounts: Record<string, number> = {};
    for (const g of activeGrants) {
      for (const s of g.grantedScopes) scopeCounts[s] = (scopeCounts[s] ?? 0) + 1;
    }
    const scopeGrantRates: Record<string, number> = {};
    for (const [scope, count] of Object.entries(scopeCounts)) {
      scopeGrantRates[scope] =
        Math.round((count / (activeGrants.length || 1)) * 1000) / 1000;
    }

    return {
      newMembers: activeGrants.length,
      activeGrants: activeGrants.length,
      totalRequests: all,
      approvedRequests: approved.length,
      deniedRequests: denied,
      consentRate: Math.round(consentRate * 1000) / 1000,
      avgCheckoutSeconds,
      scopeGrantRates,
    };
  }

  // ─── helpers ───────────────────────────────────────────────────────────────
  private async loadByTokenFresh(token: string): Promise<IdentityRequest> {
    const request = await this.requests.findOne({ where: { requestToken: token } });
    if (!request) throw new NotFoundException('Identity request not found.');
    await this.refreshExpiry(request);
    return request;
  }

  private async refreshExpiry(request: IdentityRequest): Promise<void> {
    if (request.status === 'pending' && request.expiresAt.getTime() < Date.now()) {
      request.status = 'expired';
      await this.requests.save(request);
    }
  }

  private merchantRequestView(request: IdentityRequest) {
    return {
      requestId: request.id,
      requestToken: request.requestToken,
      status: request.status,
      branchId: request.branchId,
      requestedScopes: request.requestedScopes,
      requiredScopes: request.requiredScopes,
      reference: request.reference,
      expiresAt: request.expiresAt,
      // What the cashier's screen encodes into the QR:
      qr: {
        deeplink: `spark://join?rt=${request.requestToken}`,
        universalLink: `https://app.spark-rin.com/join?rt=${request.requestToken}`,
      },
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

function unique(arr: string[]): string[] {
  return Array.from(new Set(arr));
}
