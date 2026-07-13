import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainEvent, EventType } from './domain-events';
import { createTransport, EventHandler, EventTransport } from './transport';
import { AppConfig } from '../../config/configuration';

/**
 * The event-driven backbone. A thin facade over a swappable {@link EventTransport}
 * (in-process by default, NATS when configured) — every publisher/subscriber in
 * the platform depends only on this stable API.
 */
@Injectable()
export class EventBus {
  private readonly logger = new Logger(EventBus.name);
  private readonly transport: EventTransport;

  constructor(config: ConfigService<AppConfig, true>) {
    const cfg = config.get('events', { infer: true });
    this.transport = createTransport(cfg.transport, cfg.natsUrl, this.logger);
    this.logger.log(`Event transport: ${cfg.transport}`);
  }

  publish(event: DomainEvent): void {
    this.logger.debug(`publish ${event.type} (${event.id}) merchant=${event.merchantId}`);
    this.transport.publish(event);
  }

  subscribe(type: EventType, handler: EventHandler): void {
    this.transport.subscribe(type, handler);
  }
}
