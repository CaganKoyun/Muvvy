import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration, { AppConfig } from './config/configuration';
import { buildTypeOrmOptions } from './config/data-source';

import { EventsModule } from './common/events/events.module';
import { AuthModule } from './common/auth/auth.module';
import { AuditModule } from './common/audit/audit.module';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { HealthModule } from './common/health/health.module';

import { IdentityModule } from './modules/identity/identity.module';
import { ProfileModule } from './modules/profile/profile.module';
import { MerchantModule } from './modules/merchant/merchant.module';
import { ConsentModule } from './modules/consent/consent.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) =>
        buildTypeOrmOptions(config.get('db', { infer: true })),
    }),
    // cross-cutting
    EventsModule,
    AuthModule,
    AuditModule,
    IdempotencyModule,
    HealthModule,
    // bounded contexts
    IdentityModule,
    ProfileModule,
    MerchantModule,
    ConsentModule,
    WebhooksModule,
  ],
})
export class AppModule {}
