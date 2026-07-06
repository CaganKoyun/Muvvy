import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../common/events/event-bus';
import { EventType } from '../../common/events/domain-events';
import { WebhookService } from './webhook.service';

/** Bridges the domain event bus to webhook delivery. */
@Injectable()
export class WebhookDispatcher implements OnModuleInit {
  constructor(
    private readonly events: EventBus,
    private readonly webhooks: WebhookService,
  ) {}

  onModuleInit(): void {
    for (const type of Object.values(EventType)) {
      this.events.subscribe(type, (event) => this.webhooks.dispatch(event));
    }
  }
}
