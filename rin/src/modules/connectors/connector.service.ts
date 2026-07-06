import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Connector, ConnectorSyncLog } from './entities';
import { CreateConnectorDto } from './dto';
import { DomainEvent, EventType } from '../../common/events/domain-events';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class ConnectorService {
  private readonly logger = new Logger(ConnectorService.name);

  constructor(
    @InjectRepository(Connector) private readonly connectors: Repository<Connector>,
    @InjectRepository(ConnectorSyncLog) private readonly logs: Repository<ConnectorSyncLog>,
    private readonly wallet: WalletService,
  ) {}

  async create(merchantId: string, dto: CreateConnectorDto) {
    return this.connectors.save(
      this.connectors.create({
        merchantId,
        kind: dto.kind,
        adapter: dto.adapter,
        name: dto.name,
        config: dto.config ?? null,
      }),
    );
  }

  async list(merchantId: string) {
    return this.connectors.find({ where: { merchantId }, order: { createdAt: 'DESC' } });
  }

  async syncLogs(merchantId: string, connectorId: string) {
    return this.logs.find({
      where: { merchantId, connectorId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  /** Normalize a domain event and fan it out to the merchant's connectors. */
  async handleEvent(event: DomainEvent): Promise<void> {
    const normalized = normalize(event);
    if (!normalized) return;
    const targets = await this.connectors.find({
      where: { merchantId: event.merchantId, active: true },
    });
    for (const c of targets) {
      let status = 'delivered';
      if (c.adapter === 'rest') {
        status = await this.postRest(c, normalized).catch(() => 'failed');
      }
      await this.logs.save(
        this.logs.create({
          connectorId: c.id,
          merchantId: event.merchantId,
          operation: normalized.operation,
          record: normalized.record,
          status,
        }),
      );
    }
  }

  private async postRest(
    connector: Connector,
    normalized: { operation: string; record: unknown },
  ): Promise<string> {
    const url = connector.config?.url as string | undefined;
    if (!url) return 'skipped';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(normalized),
        signal: controller.signal,
      });
      return res.ok ? 'delivered' : 'failed';
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Bulk-ingest receipts from CSV (the "CSV Import" integration). Columns:
   *   grantId,externalId,purchasedAt,itemName,unitPriceMinor,quantity,warrantyMonths,returnDays
   * Rows sharing (grantId, externalId) are merged into one multi-item receipt.
   */
  async importReceiptsCsv(merchantId: string, csv: string) {
    const rows = parseCsv(csv);
    const groups = new Map<string, { grantId: string; externalId: string; purchasedAt: string; items: any[] }>();
    const errors: string[] = [];

    for (const [i, r] of rows.entries()) {
      if (!r.grantId || !r.itemName) {
        errors.push(`row ${i + 1}: missing grantId or itemName`);
        continue;
      }
      const key = `${r.grantId}::${r.externalId ?? ''}`;
      if (!groups.has(key)) {
        groups.set(key, {
          grantId: r.grantId,
          externalId: r.externalId ?? '',
          purchasedAt: r.purchasedAt || new Date().toISOString(),
          items: [],
        });
      }
      groups.get(key)!.items.push({
        name: r.itemName,
        quantity: Number(r.quantity || '1'),
        unitPriceMinor: Number(r.unitPriceMinor || '0'),
        warrantyMonths: r.warrantyMonths ? Number(r.warrantyMonths) : undefined,
        returnDays: r.returnDays ? Number(r.returnDays) : undefined,
      });
    }

    let imported = 0;
    for (const g of groups.values()) {
      try {
        await this.wallet.uploadReceipt(merchantId, {
          grantId: g.grantId,
          externalId: g.externalId || undefined,
          purchasedAt: g.purchasedAt,
          items: g.items,
        });
        imported++;
      } catch (err) {
        errors.push(`receipt ${g.grantId}/${g.externalId}: ${(err as Error).message}`);
      }
    }
    return { receiptsImported: imported, groups: groups.size, errors };
  }
}

function normalize(event: DomainEvent): { operation: string; record: unknown } | null {
  const d = event.data as Record<string, any>;
  switch (event.type) {
    case EventType.CustomerCreated:
    case EventType.CustomerUpdated:
      return {
        operation: 'upsert_customer',
        record: { customerRef: d.grantId, scopes: d.grantedScopes, profile: d.customer },
      };
    case EventType.ConsentChanged:
      return { operation: 'consent_changed', record: { customerRef: d.grantId, status: d.status } };
    case EventType.ReceiptUploaded:
      return {
        operation: 'receipt',
        record: { customerRef: d.grantId, receiptId: d.receiptId, totalMinor: d.totalMinor },
      };
    default:
      return null;
  }
}

interface CsvRow {
  [key: string]: string;
}
function parseCsv(csv: string): CsvRow[] {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = line.split(',').map((c) => c.trim());
    const row: CsvRow = {};
    header.forEach((h, i) => (row[h] = cols[i] ?? ''));
    return row;
  });
}
