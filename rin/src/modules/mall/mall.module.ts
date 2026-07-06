import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Mall, MallStore } from './entities';
import { MallService } from './mall.service';
import { MallMerchantController, MallConsumerController } from './mall.controllers';
import { ConsentModule } from '../consent/consent.module';
import { MerchantModule } from '../merchant/merchant.module';
import { CampaignModule } from '../campaign/campaign.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Mall, MallStore]),
    ConsentModule,
    MerchantModule,
    CampaignModule,
  ],
  controllers: [MallMerchantController, MallConsumerController],
  providers: [MallService],
  exports: [MallService],
})
export class MallModule {}
