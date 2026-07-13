import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes } from 'crypto';
import { WebhookEndpoint } from './webhook-endpoint.entity';
import { WebhookDelivery } from './webhook-delivery.entity';
import { DomainEvent } from '../../common/events/domain-events';
import { AppConfig } from '../../config/configuration';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly cfg: AppConfig['webhook'];

  constructor(
    @InjectRepository(WebhookEndpoint)
    private readonly endpoints: Repository<WebhookEndpoint>,
    @InjectRepository(WebhookDelivery)
    private readonly deliveries: Repository<WebhookDelivery>,
    config: ConfigService<AppConfig, true>,
  ) {
    this.cfg = config.get('webhook', { infer: true });
  }

  async register(merchantId: string, url: string, events?: string[]) {
    const secret = `whsec_${randomBytes(24).toString('hex')}`;
    const endpoint = await this.endpoints.save(
      this.endpoints.create({
        merchantId,
        url,
        secret,
        events: events && events.length ? events : ['*'],
      }),
    );
    // Secret is returned exactly once so the merchant can verify signatures.
    return { id: endpoint.id, url: endpoint.url, events: endpoint.events, secret };
  }

  async list(merchantId: string) {
    const rows = await this.endpoints.find({ where: { merchantId } });
    return rows.map((e) => ({
      id: e.id,
      url: e.url,
      events: e.events,
      active: e.active,
      createdAt: e.createdAt,
    }));
  }

  async listDeliveries(merchantId: string, limit = 50) {
    return this.deliveries.find({
      where: { merchantId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /** Fan a domain event out to every subscribed endpoint for its tenant. */
  async dispatch(event: DomainEvent): Promise<void> {
    const endpoints = await this.endpoints.find({
      where: { merchantId: event.merchantId, active: true },
    });
    const targets = endpoints.filter(
      (e) => e.events.includes('*') || e.events.includes(event.type),
    );
    // Never leak the raw Spark identity id across merchants.
    const payload = {
      id: event.id,
      type: event.type,
      occurredAt: event.occurredAt,
      merchant_id: event.merchantId,
      data: event.data,
    };
    await Promise.all(targets.map((e) => this.deliverTo(e, event, payload)));
  }

  private async deliverTo(
    endpoint: WebhookEndpoint,
    event: DomainEvent,
    payload: object,
  ): Promise<void> {
    const body = JSON.stringify(payload);
    const signature = createHmac('sha256', endpoint.secret).update(body).digest('hex');

    const delivery = await this.deliveries.save(
      this.deliveries.create({
        merchantId: endpoint.merchantId,
        endpointId: endpoint.id,
        eventId: event.id,
        eventType: event.type,
        payload,
        status: 'pending',
      }),
    );

    for (let attempt = 1; attempt <= this.cfg.maxAttempts; attempt++) {
      delivery.attempts = attempt;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
        const res = await fetch(endpoint.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-spark-event': event.type,
            'x-spark-event-id': event.id,
            'x-spark-signature': `sha256=${signature}`,
          },
          body,
          signal: controller.signal,
        }).finally(() => clearTimeout(timer));

        delivery.responseStatus = res.status;
        if (res.ok) {
          delivery.status = 'success';
          delivery.lastError = null;
          await this.deliveries.save(delivery);
          return;
        }
        delivery.lastError = `HTTP ${res.status}`;
      } catch (err) {
        delivery.lastError = (err as Error).message;
      }

      await this.deliveries.save(delivery);
      if (attempt < this.cfg.maxAttempts) {
        await sleep(Math.min(200 * attempt, 2000));
      }
    }

    delivery.status = 'failed';
    await this.deliveries.save(delivery);
    this.logger.warn(
      `webhook ${event.type} to ${endpoint.url} failed after ${delivery.attempts} attempts: ${delivery.lastError}`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
