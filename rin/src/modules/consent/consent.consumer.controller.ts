import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConsentService } from './consent.service';
import { ApproveRequestDto } from './dto';
import { ConsumerGuard } from '../../common/auth/consumer.guard';
import { CurrentConsumer } from '../../common/auth/current-user.decorator';
import { ConsumerPrincipal } from '../../common/auth/token.types';

/** The consumer side: view, approve/deny a request, and manage grants. */
@ApiTags('consent (consumer)')
@ApiBearerAuth()
@UseGuards(ConsumerGuard)
@Controller('v1/consent')
export class ConsentConsumerController {
  constructor(private readonly consent: ConsentService) {}

  @Get('requests/:token')
  @ApiOperation({ summary: 'View a pending request — who is asking and for what.' })
  async view(@Param('token') token: string) {
    return this.consent.viewRequestForConsumer(token);
  }

  @Post('requests/:token/approve')
  @HttpCode(201)
  @ApiOperation({ summary: 'Approve with granular scopes (POST /consent).' })
  async approve(
    @CurrentConsumer() consumer: ConsumerPrincipal,
    @Param('token') token: string,
    @Body() dto: ApproveRequestDto,
  ) {
    return this.consent.approve(consumer.id, token, dto);
  }

  @Post('requests/:token/deny')
  @HttpCode(200)
  @ApiOperation({ summary: 'Decline the request.' })
  async deny(
    @CurrentConsumer() consumer: ConsumerPrincipal,
    @Param('token') token: string,
  ) {
    return this.consent.deny(consumer.id, token);
  }

  @Get('grants')
  @ApiOperation({ summary: 'Consent Center — every store I’ve connected to.' })
  async grants(@CurrentConsumer() consumer: ConsumerPrincipal) {
    return { grants: await this.consent.listGrantsForConsumer(consumer.id) };
  }

  @Post('grants/:id/revoke')
  @HttpCode(200)
  @ApiOperation({ summary: 'One-click revoke — withdraw consent from a store.' })
  async revoke(
    @CurrentConsumer() consumer: ConsumerPrincipal,
    @Param('id') id: string,
  ) {
    return this.consent.revoke(consumer.id, id);
  }
}
