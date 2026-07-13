import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import {
  ConsumerTokenPayload,
  MerchantTokenPayload,
} from './token.types';

/** Issues and verifies the HS256 access tokens used by consumers and merchants. */
@Injectable()
export class AuthTokenService {
  private readonly jwtCfg: AppConfig['jwt'];

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.jwtCfg = config.get('jwt', { infer: true });
  }

  signConsumer(consumerId: string): { accessToken: string; expiresIn: number } {
    const payload: ConsumerTokenPayload = { sub: consumerId, typ: 'consumer' };
    return {
      accessToken: this.jwt.sign(payload, { expiresIn: this.jwtCfg.consumerTtl }),
      expiresIn: this.jwtCfg.consumerTtl,
    };
  }

  signMerchant(merchantId: string, role = 'admin'): { accessToken: string; expiresIn: number } {
    const payload: MerchantTokenPayload = { sub: merchantId, typ: 'merchant', role };
    return {
      accessToken: this.jwt.sign(payload, { expiresIn: this.jwtCfg.merchantTtl }),
      expiresIn: this.jwtCfg.merchantTtl,
    };
  }

  verify<T extends object = Record<string, unknown>>(token: string): T {
    return this.jwt.verify<T>(token);
  }
}
