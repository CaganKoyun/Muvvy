import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdempotencyRecord } from './idempotency-record.entity';
import { IdempotencyInterceptor } from './idempotency.interceptor';

/**
 * Registers the idempotency interceptor globally. It is a no-op unless the
 * request carries an `Idempotency-Key` header, so it is safe to apply to all
 * routes.
 */
@Module({
  imports: [TypeOrmModule.forFeature([IdempotencyRecord])],
  providers: [{ provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
})
export class IdempotencyModule {}
