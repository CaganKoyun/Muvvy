import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MerchantService } from './merchant.service';
import { SetConsentConfigDto, CreateBranchDto, UpdateBrandingDto } from './dto';
import { MerchantGuard } from '../../common/auth/merchant.guard';
import { CurrentMerchant } from '../../common/auth/current-user.decorator';
import { MerchantPrincipal } from '../../common/auth/token.types';
import { SCOPE_CATALOG } from '../../common/scopes';

@ApiTags('merchant')
@ApiBearerAuth()
@UseGuards(MerchantGuard)
@Controller('v1/merchant')
export class MerchantController {
  constructor(private readonly merchants: MerchantService) {}

  @Get('me')
  @ApiOperation({ summary: 'The authenticated merchant tenant.' })
  async me(@CurrentMerchant() principal: MerchantPrincipal) {
    const merchant = await this.merchants.findById(principal.id);
    return {
      id: merchant.id,
      name: merchant.name,
      slug: merchant.slug,
      category: merchant.category,
      status: merchant.status,
      branding: {
        displayName: merchant.displayName,
        logoUrl: merchant.logoUrl,
        primaryColor: merchant.primaryColor,
        postConsentRedirectUrl: merchant.postConsentRedirectUrl,
      },
    };
  }

  @Put('branding')
  @ApiOperation({ summary: 'Update brand identity (logo, colour, post-consent redirect).' })
  async setBranding(
    @CurrentMerchant() principal: MerchantPrincipal,
    @Body() dto: UpdateBrandingDto,
  ) {
    const m = await this.merchants.updateBranding(principal.id, dto);
    return {
      displayName: m.displayName,
      logoUrl: m.logoUrl,
      primaryColor: m.primaryColor,
      postConsentRedirectUrl: m.postConsentRedirectUrl,
    };
  }

  @Get('branches')
  @ApiOperation({ summary: 'List this brand’s branches (şube).' })
  async branches(@CurrentMerchant() principal: MerchantPrincipal) {
    return { branches: await this.merchants.listBranches(principal.id) };
  }

  @Post('branches')
  @ApiOperation({ summary: 'Add a branch to this brand.' })
  async addBranch(
    @CurrentMerchant() principal: MerchantPrincipal,
    @Body() dto: CreateBranchDto,
  ) {
    return this.merchants.createBranch(principal.id, dto);
  }

  @Get('consent-config')
  @ApiOperation({ summary: 'The scopes this merchant requests (Consent Engine config).' })
  async getConfig(@CurrentMerchant() principal: MerchantPrincipal) {
    const fields = await this.merchants.getRequestedFields(principal.id);
    return {
      fields: fields.map((f) => ({
        scopeKey: f.scopeKey,
        required: f.required,
        ...describe(f.scopeKey),
      })),
    };
  }

  @Put('consent-config')
  @ApiOperation({ summary: 'Replace the scopes this merchant requests.' })
  async setConfig(
    @CurrentMerchant() principal: MerchantPrincipal,
    @Body() dto: SetConsentConfigDto,
  ) {
    const fields = await this.merchants.setRequestedFields(principal.id, dto.fields);
    return { fields: fields.map((f) => ({ scopeKey: f.scopeKey, required: f.required })) };
  }
}

function describe(scopeKey: string) {
  const def = SCOPE_CATALOG[scopeKey];
  return def
    ? { label: def.label, category: def.category, pii: def.pii }
    : { label: scopeKey, category: 'unknown', pii: false };
}
