import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../common/events/event-bus';
import { EventType } from '../../common/events/domain-events';
import { ConnectorService } from './connector.service';

/** Bridges domain events to the merchant's configured CRM/POS/ERP connectors. */
@Injectable()
export class ConnectorDispatcher implements OnModuleInit {
  constructor(
    private readonly events: EventBus,
    private readonly connectors: ConnectorService,
  ) {}

  onModuleInit(): void {
    for (const type of [
      EventType.CustomerCreated,
      EventType.CustomerUpdated,
      EventType.ConsentChanged,
      EventType.ReceiptUploaded,
    ]) {
      this.events.subscribe(type, (event) => this.connectors.handleEvent(event));
    }
  }
}
