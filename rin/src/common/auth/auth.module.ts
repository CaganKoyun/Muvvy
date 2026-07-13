import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { AuthTokenService } from './auth-token.service';
import { ConsumerGuard } from './consumer.guard';
import { MerchantGuard } from './merchant.guard';

/** Global auth: token signing/verification + the consumer & merchant guards. */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        secret: config.get('jwt', { infer: true }).secret,
        signOptions: { algorithm: 'HS256', issuer: 'spark-rin' },
        verifyOptions: { algorithms: ['HS256'], issuer: 'spark-rin' },
      }),
    }),
  ],
  providers: [AuthTokenService, ConsumerGuard, MerchantGuard],
  exports: [AuthTokenService, ConsumerGuard, MerchantGuard, JwtModule],
})
export class AuthModule {}
