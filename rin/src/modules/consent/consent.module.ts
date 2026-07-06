import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityRequest } from './identity-request.entity';
import { ConsentGrant } from './consent-grant.entity';
import { ConsentService } from './consent.service';
import { ConsentMerchantController } from './consent.merchant.controller';
import { ConsentConsumerController } from './consent.consumer.controller';
import { MerchantModule } from '../merchant/merchant.module';
import { ProfileModule } from '../profile/profile.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([IdentityRequest, ConsentGrant]),
    MerchantModule,
    ProfileModule,
  ],
  controllers: [ConsentMerchantController, ConsentConsumerController],
  providers: [ConsentService],
  exports: [ConsentService],
})
export class ConsentModule {}
