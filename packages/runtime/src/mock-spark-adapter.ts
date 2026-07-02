/**
 * MockSparkAdapter — ilk Tier-1 host (Spark/KOBIL) için referans adapter iskeleti.
 * Gerçek implementasyonda `authenticate` KOBIL SSO token exchange'ine,
 * `pay` host'un ödeme rayına bağlanır; arayüz sözleşmesi aynı kalır.
 */
import type { PayRequest, PayResult } from '@grid/sdk';
import type { HostAdapter, HostUser } from './index.js';

export interface MockSparkOptions {
  hostId?: string;
  user?: HostUser;
  /** Ödeme rayını kapatmak için (capability farkı senaryoları). */
  payEnabled?: boolean;
}

export class MockSparkAdapter implements HostAdapter {
  readonly hostId: string;
  private readonly user: HostUser;
  private readonly payEnabled: boolean;
  private txCounter = 0;

  constructor(opts: MockSparkOptions = {}) {
    this.hostId = opts.hostId ?? 'spark';
    this.payEnabled = opts.payEnabled ?? true;
    this.user = opts.user ?? {
      id: 'kobil-user-42',
      name: 'Test Kullanıcısı',
      claims: { kyc_level: 'full', kyc_country: 'TR' },
    };
  }

  capabilities(): string[] {
    return this.payEnabled
      ? ['identity.basic', 'identity.kyc', 'pay.native']
      : ['identity.basic', 'identity.kyc'];
  }

  async authenticate(): Promise<HostUser> {
    return this.user;
  }

  async pay(request: PayRequest): Promise<PayResult> {
    if (!this.payEnabled) {
      return { status: 'declined' };
    }
    if (request.amount <= 0 || !request.currency) {
      return { status: 'declined' };
    }
    this.txCounter += 1;
    return { status: 'approved', transactionId: `${this.hostId}-tx-${this.txCounter}` };
  }

  async raw(method: string, params?: unknown): Promise<unknown> {
    if (method === 'spark.echo') return params;
    throw new Error(`Spark ham SDK'sında bilinmeyen metot: ${method}`);
  }
}
