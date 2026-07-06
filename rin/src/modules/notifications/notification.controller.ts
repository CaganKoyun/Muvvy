import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationService } from './notification.service';
import { ConsumerGuard } from '../../common/auth/consumer.guard';
import { CurrentConsumer } from '../../common/auth/current-user.decorator';
import { ConsumerPrincipal } from '../../common/auth/token.types';

@ApiTags('notifications (consumer)')
@ApiBearerAuth()
@UseGuards(ConsumerGuard)
@Controller('v1/me/notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  @ApiOperation({ summary: 'My Notification Center — campaigns, coupons, warranty reminders.' })
  async list(@CurrentConsumer() c: ConsumerPrincipal) {
    return this.notifications.list(c.id);
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark a notification read.' })
  async read(@CurrentConsumer() c: ConsumerPrincipal, @Param('id') id: string) {
    return this.notifications.markRead(c.id, id);
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark all read.' })
  async readAll(@CurrentConsumer() c: ConsumerPrincipal) {
    return this.notifications.markAllRead(c.id);
  }

  @Post('refresh-warranties')
  @ApiOperation({ summary: 'Generate warranty-expiry reminders from my wallet.' })
  async refresh(
    @CurrentConsumer() c: ConsumerPrincipal,
    @Query('withinDays') withinDays?: string,
  ) {
    return this.notifications.refreshWarrantyReminders(c.id, withinDays ? Number(withinDays) : 30);
  }
}
