import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConsentService } from './consent.service';
import { CreateIdentityRequestDto } from './dto';
import { MerchantGuard } from '../../common/auth/merchant.guard';
import { CurrentMerchant } from '../../common/auth/current-user.decorator';
import { MerchantPrincipal } from '../../common/auth/token.types';

/** The merchant side of the handshake + the customer directory & dashboard. */
@ApiTags('consent (merchant)')
@ApiBearerAuth()
@UseGuards(MerchantGuard)
@Controller('v1')
export class ConsentMerchantController {
  constructor(private readonly consent: ConsentService) {}

  @Post('identity/requests')
  @ApiOperation({
    summary: 'Create a "Continue with Spark" request (the QR the cashier shows).',
  })
  async createRequest(
    @CurrentMerchant() merchant: MerchantPrincipal,
    @Body() dto: CreateIdentityRequestDto,
  ) {
    return this.consent.createRequest(merchant.id, dto);
  }

  @Get('identity/requests/:id')
  @ApiOperation({ summary: 'Poll a request; once approved, returns the consented customer.' })
  async getRequest(
    @CurrentMerchant() merchant: MerchantPrincipal,
    @Param('id') id: string,
  ) {
    return this.consent.getRequestResultForMerchant(merchant.id, id);
  }

  @Get('customers')
  @ApiOperation({ summary: 'List this merchant’s consented customers.' })
  async listCustomers(@CurrentMerchant() merchant: MerchantPrincipal) {
    return { customers: await this.consent.listCustomers(merchant.id) };
  }

  @Get('customers/:grantId')
  @ApiOperation({ summary: 'Read one consented customer (POST /customer analog).' })
  async getCustomer(
    @CurrentMerchant() merchant: MerchantPrincipal,
    @Param('grantId') grantId: string,
  ) {
    return this.consent.getCustomerForMerchant(merchant.id, grantId);
  }

  @Get('merchant/dashboard')
  @ApiOperation({ summary: 'Merchant analytics: members, consent rate, checkout time.' })
  async dashboard(@CurrentMerchant() merchant: MerchantPrincipal) {
    return this.consent.dashboard(merchant.id);
  }
}
