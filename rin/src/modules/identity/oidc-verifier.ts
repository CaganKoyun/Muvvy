import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHmac,
  createPublicKey,
  timingSafeEqual,
  verify as cryptoVerify,
} from 'crypto';
import { AppConfig } from '../../config/configuration';

export interface VerifiedIdentity {
  provider: string;
  subject: string;
  email: string | null;
}

/**
 * Verifies social-login ID tokens.
 *  - `demo`   : an HS256 token minted by {@link makeDemoIdToken}, so the social
 *               flow is exercised end-to-end with no external network.
 *  - `google` : a real RS256 Google ID token, verified against Google's JWKS.
 *  - `apple`  : same generic JWKS path against Apple's keys.
 */
@Injectable()
export class OidcVerifier {
  private readonly cfg: AppConfig['oidc'];

  constructor(config: ConfigService<AppConfig, true>) {
    this.cfg = config.get('oidc', { infer: true });
  }

  async verify(provider: string, idToken: string): Promise<VerifiedIdentity> {
    switch (provider) {
      case 'demo':
        return this.verifyDemo(idToken);
      case 'google':
        return this.verifyJwks(idToken, 'google', 'https://www.googleapis.com/oauth2/v3/certs', [
          'https://accounts.google.com',
          'accounts.google.com',
        ], this.cfg.googleClientId);
      case 'apple':
        return this.verifyJwks(idToken, 'apple', 'https://appleid.apple.com/auth/keys', [
          'https://appleid.apple.com',
        ], '');
      default:
        throw new UnauthorizedException(`Unsupported provider '${provider}'.`);
    }
  }

  private verifyDemo(idToken: string): VerifiedIdentity {
    const [h, p, s] = idToken.split('.');
    if (!h || !p || !s) throw new UnauthorizedException('Malformed token.');
    const expected = createHmac('sha256', this.cfg.demoSecret)
      .update(`${h}.${p}`)
      .digest();
    const got = Buffer.from(s, 'base64url');
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
      throw new UnauthorizedException('Invalid demo token signature.');
    }
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    this.assertNotExpired(payload);
    if (!payload.sub) throw new UnauthorizedException('Token missing sub.');
    return { provider: 'demo', subject: String(payload.sub), email: payload.email ?? null };
  }

  private async verifyJwks(
    idToken: string,
    provider: string,
    jwksUrl: string,
    issuers: string[],
    expectedAud: string,
  ): Promise<VerifiedIdentity> {
    const [h, p, s] = idToken.split('.');
    if (!h || !p || !s) throw new UnauthorizedException('Malformed token.');
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));

    const res = await fetch(jwksUrl);
    if (!res.ok) throw new UnauthorizedException('Could not fetch provider keys.');
    const { keys } = (await res.json()) as { keys: Array<Record<string, string>> };
    const jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) throw new UnauthorizedException('Signing key not found.');

    const key = createPublicKey({ key: jwk as any, format: 'jwk' });
    const ok = cryptoVerify(
      'RSA-SHA256',
      Buffer.from(`${h}.${p}`),
      key,
      Buffer.from(s, 'base64url'),
    );
    if (!ok) throw new UnauthorizedException('Invalid token signature.');
    if (!issuers.includes(payload.iss)) throw new UnauthorizedException('Unexpected issuer.');
    if (expectedAud && payload.aud !== expectedAud) throw new UnauthorizedException('Audience mismatch.');
    this.assertNotExpired(payload);

    return { provider, subject: String(payload.sub), email: payload.email ?? null };
  }

  private assertNotExpired(payload: { exp?: number }): void {
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      throw new UnauthorizedException('Token expired.');
    }
  }
}

/** Mint a `demo` provider ID token (used by the demo/tests to simulate an IdP). */
export function makeDemoIdToken(
  secret: string,
  claims: { sub: string; email?: string; exp?: number },
): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, ...claims }),
  ).toString('base64url');
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}
