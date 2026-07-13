import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import { UploadReceiptDto, IssueWalletItemDto } from './dto';
import { MerchantGuard } from '../../common/auth/merchant.guard';
import { ConsumerGuard } from '../../common/auth/consumer.guard';
import { CurrentMerchant, CurrentConsumer } from '../../common/auth/current-user.decorator';
import { MerchantPrincipal, ConsumerPrincipal } from '../../common/auth/token.types';

@ApiTags('wallet (merchant)')
@ApiBearerAuth()
@UseGuards(MerchantGuard)
@Controller('v1')
export class WalletMerchantController {
  constructor(private readonly wallet: WalletService) {}

  @Post('receipts')
  @ApiOperation({ summary: 'Upload a digital receipt to a consented customer (Receipt API).' })
  async upload(@CurrentMerchant() m: MerchantPrincipal, @Body() dto: UploadReceiptDto) {
    return this.wallet.uploadReceipt(m.id, dto);
  }

  @Post('wallet/issue')
  @ApiOperation({ summary: 'Issue a gift card / coupon / loyalty card to a customer.' })
  async issue(@CurrentMerchant() m: MerchantPrincipal, @Body() dto: IssueWalletItemDto) {
    return this.wallet.issueWalletItem(m.id, dto);
  }
}

@ApiTags('wallet (consumer)')
@ApiBearerAuth()
@UseGuards(ConsumerGuard)
@Controller('v1/me')
export class WalletConsumerController {
  constructor(private readonly wallet: WalletService) {}

  @Get('receipts')
  @ApiOperation({ summary: 'My digital receipts.' })
  async receipts(@CurrentConsumer() c: ConsumerPrincipal) {
    return { receipts: await this.wallet.listReceipts(c.id) };
  }

  @Get('receipts/:id')
  @ApiOperation({ summary: 'One receipt with items, warranties and return windows.' })
  async receipt(@CurrentConsumer() c: ConsumerPrincipal, @Param('id') id: string) {
    return (await this.wallet.getReceipt(c.id, id)) ?? { notFound: true };
  }

  @Get('warranties')
  @ApiOperation({ summary: 'My warranty wallet.' })
  async warranties(@CurrentConsumer() c: ConsumerPrincipal) {
    return { warranties: await this.wallet.listWarranties(c.id) };
  }

  @Get('wallet')
  @ApiOperation({ summary: 'My wallet — gift cards, coupons, loyalty & membership cards.' })
  async wallet_(@CurrentConsumer() c: ConsumerPrincipal) {
    return this.wallet.listWallet(c.id);
  }

  @Get('timeline')
  @ApiOperation({ summary: 'My purchase timeline.' })
  async timeline(@CurrentConsumer() c: ConsumerPrincipal) {
    return { timeline: await this.wallet.timeline(c.id) };
  }
}
