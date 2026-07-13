import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthTokenService } from './auth-token.service';
import { MerchantTokenPayload } from './token.types';
import { extractBearer } from './consumer.guard';

/**
 * Requires a valid **merchant** access token (obtained via the OAuth2
 * client_credentials grant); attaches `req.merchant` for tenant scoping.
 */
@Injectable()
export class MerchantGuard implements CanActivate {
  constructor(private readonly tokens: AuthTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const token = extractBearer(req);
    if (!token) throw new UnauthorizedException('Missing bearer token.');

    let payload: MerchantTokenPayload;
    try {
      payload = this.tokens.verify<MerchantTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token.');
    }
    if (payload.typ !== 'merchant') {
      throw new UnauthorizedException('A merchant token is required for this endpoint.');
    }
    req.merchant = { id: payload.sub, role: payload.role };
    return true;
  }
}
