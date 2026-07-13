import { Logger } from '@nestjs/common';
import { EventEmitter } from 'events';
import { DomainEvent, EventType } from './domain-events';

export type EventHandler = (event: DomainEvent) => void | Promise<void>;

/**
 * The transport seam. `inproc` is the default (single deployable); `nats` swaps
 * in a real broker for horizontal scale — publishers and subscribers are
 * unchanged because they only depend on this interface.
 */
export interface EventTransport {
  publish(event: DomainEvent): void;
  subscribe(type: EventType, handler: EventHandler): void;
}

/** In-process backbone: fire-and-forget, deferred, never crashes the caller. */
export class InProcessTransport implements EventTransport {
  private readonly emitter = new EventEmitter();

  constructor(private readonly logger: Logger) {
    this.emitter.setMaxListeners(100);
    this.emitter.on('error', (err) => this.logger.error(`handler error: ${err?.message ?? err}`));
  }

  publish(event: DomainEvent): void {
    setImmediate(() => {
      try {
        this.emitter.emit(event.type, event);
      } catch (err) {
        this.logger.error(`emit failed for ${event.type}: ${(err as Error).message}`);
      }
    });
  }

  subscribe(type: EventType, handler: EventHandler): void {
    this.emitter.on(type, (event: DomainEvent) => {
      Promise.resolve()
        .then(() => handler(event))
        .catch((err) => this.logger.error(`subscriber ${type} failed: ${(err as Error).message}`));
    });
  }
}

/**
 * NATS-backed transport. Structurally complete; activated with
 * EVENT_TRANSPORT=nats + a reachable NATS_URL. The `nats` client is required
 * lazily so the default build/run needs no broker or extra dependency.
 */
export class NatsTransport implements EventTransport {
  private nc: any;
  private codec: any;
  private ready: Promise<void>;
  private readonly pending: Array<{ type: EventType; handler: EventHandler }> = [];

  constructor(
    url: string,
    private readonly logger: Logger,
  ) {
    this.ready = this.connect(url);
  }

  private async connect(url: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nats = require('nats');
    this.nc = await nats.connect({ servers: url });
    this.codec = nats.JSONCodec();
    this.logger.log(`NATS transport connected: ${url}`);
    for (const s of this.pending) this.bind(s.type, s.handler);
    this.pending.length = 0;
  }

  publish(event: DomainEvent): void {
    this.ready
      .then(() => this.nc.publish(`rin.events.${event.type}`, this.codec.encode(event)))
      .catch((err) => this.logger.error(`NATS publish failed: ${(err as Error).message}`));
  }

  subscribe(type: EventType, handler: EventHandler): void {
    if (this.nc) this.bind(type, handler);
    else this.pending.push({ type, handler });
  }

  private bind(type: EventType, handler: EventHandler): void {
    const sub = this.nc.subscribe(`rin.events.${type}`);
    (async () => {
      for await (const msg of sub) {
        Promise.resolve()
          .then(() => handler(this.codec.decode(msg.data)))
          .catch((err) => this.logger.error(`NATS handler ${type}: ${(err as Error).message}`));
      }
    })();
  }
}

export function createTransport(
  kind: 'inproc' | 'nats',
  natsUrl: string,
  logger: Logger,
): EventTransport {
  if (kind === 'nats') {
    try {
      return new NatsTransport(natsUrl, logger);
    } catch (err) {
      logger.warn(`NATS transport unavailable (${(err as Error).message}); using in-process.`);
    }
  }
  return new InProcessTransport(logger);
}
