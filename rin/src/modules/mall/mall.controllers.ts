import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MallService } from './mall.service';
import { MerchantGuard } from '../../common/auth/merchant.guard';
import { ConsumerGuard } from '../../common/auth/consumer.guard';
import { CurrentMerchant, CurrentConsumer } from '../../common/auth/current-user.decorator';
import { MerchantPrincipal, ConsumerPrincipal } from '../../common/auth/token.types';

@ApiTags('mall (merchant)')
@ApiBearerAuth()
@UseGuards(MerchantGuard)
@Controller('v1/malls')
export class MallMerchantController {
  constructor(private readonly malls: MallService) {}

  @Get()
  @ApiOperation({ summary: 'Malls this merchant participates in.' })
  async mine(@CurrentMerchant() m: MerchantPrincipal) {
    return { malls: await this.malls.mallsForMerchant(m.id) };
  }

  @Get(':id/dashboard')
  @ApiOperation({ summary: 'Mall-wide identity dashboard (member stores only).' })
  async dashboard(@CurrentMerchant() m: MerchantPrincipal, @Param('id') id: string) {
    await this.malls.assertMerchantInMall(id, m.id);
    return this.malls.dashboard(id);
  }
}

@ApiTags('mall (consumer)')
@ApiBearerAuth()
@UseGuards(ConsumerGuard)
@Controller('v1/me/malls')
export class MallConsumerController {
  constructor(private readonly malls: MallService) {}

  @Get()
  @ApiOperation({ summary: 'Malls I’ve engaged with (via a connected store).' })
  async mine(@CurrentConsumer() c: ConsumerPrincipal) {
    return { malls: await this.malls.mallsForConsumer(c.id) };
  }
}
