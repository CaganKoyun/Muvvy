import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WebhookService } from './webhook.service';
import { RegisterEndpointDto } from './dto';
import { MerchantGuard } from '../../common/auth/merchant.guard';
import { CurrentMerchant } from '../../common/auth/current-user.decorator';
import { MerchantPrincipal } from '../../common/auth/token.types';

@ApiTags('webhooks (merchant)')
@ApiBearerAuth()
@UseGuards(MerchantGuard)
@Controller('v1/webhooks')
export class WebhookController {
  constructor(private readonly webhooks: WebhookService) {}

  @Post('endpoints')
  @ApiOperation({ summary: 'Register a webhook endpoint (returns signing secret once).' })
  async register(
    @CurrentMerchant() merchant: MerchantPrincipal,
    @Body() dto: RegisterEndpointDto,
  ) {
    return this.webhooks.register(merchant.id, dto.url, dto.events);
  }

  @Get('endpoints')
  @ApiOperation({ summary: 'List my webhook endpoints.' })
  async list(@CurrentMerchant() merchant: MerchantPrincipal) {
    return { endpoints: await this.webhooks.list(merchant.id) };
  }

  @Get('deliveries')
  @ApiOperation({ summary: 'Recent delivery attempts (debugging).' })
  async deliveries(@CurrentMerchant() merchant: MerchantPrincipal) {
    return { deliveries: await this.webhooks.listDeliveries(merchant.id) };
  }
}
