import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ActorType, AuditLog } from './audit-log.entity';

export interface AuditInput {
  actorType: ActorType;
  actorId?: string | null;
  action: string;
  merchantId?: string | null;
  consumerId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  /** Record an audit event. Never throws into the caller's flow. */
  async record(input: AuditInput): Promise<void> {
    try {
      await this.repo.save(
        this.repo.create({
          actorType: input.actorType,
          actorId: input.actorId ?? null,
          action: input.action,
          merchantId: input.merchantId ?? null,
          consumerId: input.consumerId ?? null,
          resourceType: input.resourceType ?? null,
          resourceId: input.resourceId ?? null,
          metadata: input.metadata ?? null,
          ip: input.ip ?? null,
        }),
      );
    } catch (err) {
      this.logger.error(`failed to write audit '${input.action}': ${(err as Error).message}`);
    }
  }

  /** Consumer-facing Transparency Center feed. */
  async forConsumer(consumerId: string, limit = 100): Promise<AuditLog[]> {
    return this.repo.find({
      where: { consumerId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
