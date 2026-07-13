/**
 * Domain events published across bounded contexts. These map 1:1 to the
 * webhook event types in the PRD. The in-process bus (this MVP) can be swapped
 * for Kafka/NATS/RabbitMQ later without touching publishers or subscribers.
 */
export enum EventType {
  CustomerCreated = 'CustomerCreated',
  CustomerUpdated = 'CustomerUpdated',
  ConsentChanged = 'ConsentChanged',
  IdentityVerified = 'IdentityVerified',
  ReceiptUploaded = 'ReceiptUploaded',
  WalletItemIssued = 'WalletItemIssued',
  CampaignCreated = 'CampaignCreated',
}

export interface DomainEvent<T = Record<string, unknown>> {
  /** Unique event id — also used as the webhook idempotency key. */
  id: string;
  type: EventType;
  /** ISO-8601 timestamp. */
  occurredAt: string;
  /** Tenant the event belongs to; every subscriber filters on this. */
  merchantId: string;
  /** The Spark identity involved, when applicable. */
  consumerId?: string;
  data: T;
}
