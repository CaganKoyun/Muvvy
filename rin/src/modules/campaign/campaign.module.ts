import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Campaign, Membership } from './entities';
import { CampaignService } from './campaign.service';
import { CampaignMerchantController, MembershipConsumerController } from './campaign.controllers';
import { ConsentModule } from '../consent/consent.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Campaign, Membership]),
    ConsentModule,
    NotificationsModule,
  ],
  controllers: [CampaignMerchantController, MembershipConsumerController],
  providers: [CampaignService],
  exports: [CampaignService],
})
export class CampaignModule {}
