import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CampaignService } from './campaign.service';
import { CreateCampaignDto, UpsertMembershipDto } from './dto';
import { MerchantGuard } from '../../common/auth/merchant.guard';
import { ConsumerGuard } from '../../common/auth/consumer.guard';
import { CurrentMerchant, CurrentConsumer } from '../../common/auth/current-user.decorator';
import { MerchantPrincipal, ConsumerPrincipal } from '../../common/auth/token.types';

@ApiTags('campaigns & membership (merchant)')
@ApiBearerAuth()
@UseGuards(MerchantGuard)
@Controller('v1')
export class CampaignMerchantController {
  constructor(private readonly campaigns: CampaignService) {}

  @Post('campaigns')
  @ApiOperation({ summary: 'Send a campaign — only to customers who consented (Campaign API).' })
  async create(@CurrentMerchant() m: MerchantPrincipal, @Body() dto: CreateCampaignDto) {
    return this.campaigns.createCampaign(m.id, dto);
  }

  @Get('campaigns')
  @ApiOperation({ summary: 'My campaigns.' })
  async list(@CurrentMerchant() m: MerchantPrincipal) {
    return { campaigns: await this.campaigns.listCampaigns(m.id) };
  }

  @Post('memberships')
  @ApiOperation({ summary: 'Create/update a membership (tier, points) for a customer.' })
  async upsertMembership(@CurrentMerchant() m: MerchantPrincipal, @Body() dto: UpsertMembershipDto) {
    return this.campaigns.upsertMembership(m.id, dto);
  }

  @Get('memberships')
  @ApiOperation({ summary: 'My members.' })
  async members(@CurrentMerchant() m: MerchantPrincipal) {
    return { members: await this.campaigns.listMembers(m.id) };
  }
}

@ApiTags('membership (consumer)')
@ApiBearerAuth()
@UseGuards(ConsumerGuard)
@Controller('v1/me/memberships')
export class MembershipConsumerController {
  constructor(private readonly campaigns: CampaignService) {}

  @Get()
  @ApiOperation({ summary: 'My memberships across stores.' })
  async mine(@CurrentConsumer() c: ConsumerPrincipal) {
    return { memberships: await this.campaigns.listForConsumer(c.id) };
  }
}
