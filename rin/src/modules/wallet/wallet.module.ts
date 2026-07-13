import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Receipt, ReceiptItem, Warranty, WalletItem } from './entities';
import { WalletService } from './wallet.service';
import { WalletMerchantController, WalletConsumerController } from './wallet.controllers';
import { ConsentModule } from '../consent/consent.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Receipt, ReceiptItem, Warranty, WalletItem]),
    ConsentModule,
  ],
  controllers: [WalletMerchantController, WalletConsumerController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
