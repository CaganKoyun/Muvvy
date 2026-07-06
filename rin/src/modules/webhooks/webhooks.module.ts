import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebhookEndpoint } from './webhook-endpoint.entity';
import { WebhookDelivery } from './webhook-delivery.entity';
import { WebhookService } from './webhook.service';
import { WebhookDispatcher } from './webhook.dispatcher';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [TypeOrmModule.forFeature([WebhookEndpoint, WebhookDelivery])],
  controllers: [WebhookController],
  providers: [WebhookService, WebhookDispatcher],
  exports: [WebhookService],
})
export class WebhooksModule {}
