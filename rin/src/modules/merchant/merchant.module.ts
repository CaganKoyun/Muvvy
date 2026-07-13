import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Merchant } from './merchant.entity';
import { MerchantCredential } from './merchant-credential.entity';
import { MerchantRequestedField } from './merchant-requested-field.entity';
import { Branch } from './branch.entity';
import { MerchantService } from './merchant.service';
import { MerchantController } from './merchant.controller';
import { OAuthController } from './oauth.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Merchant, MerchantCredential, MerchantRequestedField, Branch]),
  ],
  controllers: [MerchantController, OAuthController],
  providers: [MerchantService],
  exports: [MerchantService],
})
export class MerchantModule {}
