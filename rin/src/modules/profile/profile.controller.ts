import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto';
import { ConsumerGuard } from '../../common/auth/consumer.guard';
import { CurrentConsumer } from '../../common/auth/current-user.decorator';
import { ConsumerPrincipal } from '../../common/auth/token.types';

/** The customer's own profile — edited once, owned by the customer. */
@ApiTags('profile (consumer)')
@ApiBearerAuth()
@UseGuards(ConsumerGuard)
@Controller('v1/me/profile')
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Get()
  @ApiOperation({ summary: 'Get my profile.' })
  async get(@CurrentConsumer() principal: ConsumerPrincipal) {
    return (await this.profiles.get(principal.id)) ?? { consumerId: principal.id, empty: true };
  }

  @Put()
  @ApiOperation({ summary: 'Create or update my profile.' })
  async update(
    @CurrentConsumer() principal: ConsumerPrincipal,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.profiles.upsert(principal.id, dto);
  }
}
