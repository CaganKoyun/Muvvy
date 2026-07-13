import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { Merchant } from './merchant.entity';
import { MerchantCredential } from './merchant-credential.entity';
import { MerchantRequestedField } from './merchant-requested-field.entity';
import { Branch } from './branch.entity';
import { RequestedFieldDto, CreateBranchDto, UpdateBrandingDto } from './dto';

export interface IssuedCredential {
  clientId: string;
  clientSecret: string;
}

@Injectable()
export class MerchantService {
  constructor(
    @InjectRepository(Merchant)
    private readonly merchants: Repository<Merchant>,
    @InjectRepository(MerchantCredential)
    private readonly credentials: Repository<MerchantCredential>,
    @InjectRepository(MerchantRequestedField)
    private readonly fields: Repository<MerchantRequestedField>,
    @InjectRepository(Branch)
    private readonly branches: Repository<Branch>,
  ) {}

  // ─── Branding ──────────────────────────────────────────────────────────────
  async updateBranding(merchantId: string, dto: UpdateBrandingDto): Promise<Merchant> {
    const merchant = await this.findById(merchantId);
    if (dto.displayName !== undefined) merchant.displayName = dto.displayName;
    if (dto.logoUrl !== undefined) merchant.logoUrl = dto.logoUrl;
    if (dto.primaryColor !== undefined) merchant.primaryColor = dto.primaryColor;
    if (dto.postConsentRedirectUrl !== undefined) {
      merchant.postConsentRedirectUrl = dto.postConsentRedirectUrl;
    }
    return this.merchants.save(merchant);
  }

  /** Public branding shown on the branded consent screen. */
  branding(merchant: Merchant) {
    return {
      name: merchant.displayName ?? merchant.name,
      slug: merchant.slug,
      logoUrl: merchant.logoUrl,
      primaryColor: merchant.primaryColor,
    };
  }

  // ─── Branches (şube) ───────────────────────────────────────────────────────
  async createBranch(merchantId: string, dto: CreateBranchDto): Promise<Branch> {
    const exists = await this.branches.findOne({ where: { merchantId, code: dto.code } });
    if (exists) throw new ConflictException(`Branch code '${dto.code}' already in use.`);
    return this.branches.save(
      this.branches.create({
        merchantId,
        name: dto.name,
        code: dto.code,
        city: dto.city ?? null,
      }),
    );
  }

  async listBranches(merchantId: string): Promise<Branch[]> {
    return this.branches.find({ where: { merchantId }, order: { createdAt: 'ASC' } });
  }

  /** A branch scoped to its brand (tenant check); throws if not owned. */
  async requireBranch(merchantId: string, branchId: string): Promise<Branch> {
    const branch = await this.branches.findOne({ where: { id: branchId, merchantId } });
    if (!branch) throw new NotFoundException('Branch not found.');
    return branch;
  }

  async findBranchById(branchId: string): Promise<Branch | null> {
    return this.branches.findOne({ where: { id: branchId } });
  }

  async create(name: string, slug: string, category?: string): Promise<Merchant> {
    const exists = await this.merchants.findOne({ where: { slug } });
    if (exists) throw new ConflictException(`Merchant slug '${slug}' already in use.`);
    return this.merchants.save(this.merchants.create({ name, slug, category: category ?? null }));
  }

  async findById(id: string): Promise<Merchant> {
    const merchant = await this.merchants.findOne({ where: { id } });
    if (!merchant) throw new NotFoundException('Merchant not found.');
    return merchant;
  }

  async findBySlug(slug: string): Promise<Merchant | null> {
    return this.merchants.findOne({ where: { slug } });
  }

  /** Mint a client_id/secret pair. The plaintext secret is returned only here. */
  async issueCredentials(merchantId: string): Promise<IssuedCredential> {
    const clientId = `spark_client_${randomBytes(9).toString('hex')}`;
    const clientSecret = `secret_${randomBytes(24).toString('hex')}`;
    await this.credentials.save(
      this.credentials.create({
        merchantId,
        clientId,
        clientSecretHash: await bcrypt.hash(clientSecret, 10),
      }),
    );
    return { clientId, clientSecret };
  }

  async validateClientCredentials(clientId: string, clientSecret: string): Promise<Merchant> {
    const cred = await this.credentials.findOne({ where: { clientId, status: 'active' } });
    if (!cred || !(await bcrypt.compare(clientSecret, cred.clientSecretHash))) {
      throw new UnauthorizedException('Invalid client credentials.');
    }
    return this.findById(cred.merchantId);
  }

  async getRequestedFields(merchantId: string): Promise<MerchantRequestedField[]> {
    return this.fields.find({ where: { merchantId }, order: { scopeKey: 'ASC' } });
  }

  async requestedScopeKeys(merchantId: string): Promise<string[]> {
    return (await this.getRequestedFields(merchantId)).map((f) => f.scopeKey);
  }

  async requiredScopeKeys(merchantId: string): Promise<string[]> {
    return (await this.getRequestedFields(merchantId))
      .filter((f) => f.required)
      .map((f) => f.scopeKey);
  }

  /** Replace the merchant's Consent Engine config wholesale. */
  async setRequestedFields(
    merchantId: string,
    fields: RequestedFieldDto[],
  ): Promise<MerchantRequestedField[]> {
    await this.fields.delete({ merchantId });
    const rows = fields.map((f) =>
      this.fields.create({ merchantId, scopeKey: f.scopeKey, required: f.required }),
    );
    await this.fields.save(rows);
    return this.getRequestedFields(merchantId);
  }
}
