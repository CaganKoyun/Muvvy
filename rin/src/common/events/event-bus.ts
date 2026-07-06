import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';
import { DomainEvent, EventType } from './domain-events';

type Handler = (event: DomainEvent) => void | Promise<void>;

/**
 * In-process, event-driven backbone. `publish` is fire-and-forget from the
 * caller's perspective (handlers run on the next tick and never block or fail
 * the request that triggered them). This is the single seam to replace with a
 * real broker for horizontal scale.
 */
@Injectable()
export class EventBus {
  private readonly logger = new Logger(EventBus.name);
  private readonly emitter = new EventEmitter();

  constructor() {
    // Domain handlers must never crash the process.
    this.emitter.setMaxListeners(100);
    this.emitter.on('error', (err) =>
      this.logger.error(`event handler error: ${err?.message ?? err}`),
    );
  }

  publish(event: DomainEvent): void {
    this.logger.debug(`publish ${event.type} (${event.id}) merchant=${event.merchantId}`);
    // Defer so publishing never blocks the request path.
    setImmediate(() => {
      try {
        this.emitter.emit(event.type, event);
      } catch (err) {
        this.logger.error(`emit failed for ${event.type}: ${(err as Error).message}`);
      }
    });
  }

  subscribe(type: EventType, handler: Handler): void {
    this.emitter.on(type, (event: DomainEvent) => {
      Promise.resolve()
        .then(() => handler(event))
        .catch((err) =>
          this.logger.error(`subscriber for ${type} failed: ${(err as Error).message}`),
        );
    });
  }
}
