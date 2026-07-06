import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Connector, ConnectorSyncLog } from './entities';
import { ConnectorService } from './connector.service';
import { ConnectorDispatcher } from './connector.dispatcher';
import { ConnectorController } from './connector.controller';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [TypeOrmModule.forFeature([Connector, ConnectorSyncLog]), WalletModule],
  controllers: [ConnectorController],
  providers: [ConnectorService, ConnectorDispatcher],
  exports: [ConnectorService],
})
export class ConnectorsModule {}
