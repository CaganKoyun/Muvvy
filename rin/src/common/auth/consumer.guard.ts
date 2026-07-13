import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthTokenService } from './auth-token.service';
import { ConsumerTokenPayload } from './token.types';

/** Requires a valid Spark **consumer** access token; attaches `req.consumer`. */
@Injectable()
export class ConsumerGuard implements CanActivate {
  constructor(private readonly tokens: AuthTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const token = extractBearer(req);
    if (!token) throw new UnauthorizedException('Missing bearer token.');

    let payload: ConsumerTokenPayload;
    try {
      payload = this.tokens.verify<ConsumerTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token.');
    }
    if (payload.typ !== 'consumer') {
      throw new UnauthorizedException('A consumer token is required for this endpoint.');
    }
    req.consumer = { id: payload.sub };
    return true;
  }
}

export function extractBearer(req: { headers: Record<string, unknown> }): string | null {
  const header = (req.headers['authorization'] as string) ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}
