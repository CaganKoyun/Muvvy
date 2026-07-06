import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Observable, of } from 'rxjs';
import { switchMap, tap } from 'rxjs/operators';
import { QueryFailedError, Repository } from 'typeorm';
import { IdempotencyRecord } from './idempotency-record.entity';

/**
 * Opt-in idempotency for mutating endpoints. A client that sends an
 * `Idempotency-Key` header gets at-most-once execution: the first call runs and
 * its response is stored; identical retries replay that stored response; a
 * concurrent duplicate while the first is in flight gets 409.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @InjectRepository(IdempotencyRecord)
    private readonly repo: Repository<IdempotencyRecord>,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest();
    const key: string | undefined = req.headers['idempotency-key'];

    if (!key || (req.method !== 'POST' && req.method !== 'PATCH' && req.method !== 'PUT')) {
      return next.handle();
    }

    const method: string = req.method;
    const path: string = req.originalUrl?.split('?')[0] ?? req.url;

    const existing = await this.repo.findOne({
      where: { idempotencyKey: key, method, path },
    });
    if (existing) {
      if (existing.statusCode == null) {
        throw new ConflictException('A request with this Idempotency-Key is still in progress.');
      }
      const res = context.switchToHttp().getResponse();
      res.status(existing.statusCode);
      return of(existing.responseBody);
    }

    // Reserve the key. If two requests race, the unique index makes exactly one win.
    let record: IdempotencyRecord;
    try {
      record = await this.repo.save(
        this.repo.create({ idempotencyKey: key, method, path, statusCode: null }),
      );
    } catch (err) {
      if (err instanceof QueryFailedError) {
        throw new ConflictException('A request with this Idempotency-Key is already in progress.');
      }
      throw err;
    }

    return next.handle().pipe(
      switchMap(async (body) => {
        const res = context.switchToHttp().getResponse();
        record.statusCode = res.statusCode ?? 200;
        record.responseBody = body ?? null;
        await this.repo.save(record);
        return body;
      }),
      tap({
        error: async () => {
          // Failed request: release the reservation so the client can retry.
          await this.repo.delete({ id: record.id }).catch(() => undefined);
        },
      }),
    );
  }
}
