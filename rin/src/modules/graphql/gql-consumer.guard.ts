import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AuthTokenService } from '../../common/auth/auth-token.service';
import { ConsumerTokenPayload } from '../../common/auth/token.types';
import { extractBearer } from '../../common/auth/consumer.guard';

/** ConsumerGuard adapted to GraphQL — reads the request from the Gql context. */
@Injectable()
export class GqlConsumerGuard implements CanActivate {
  constructor(private readonly tokens: AuthTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = GqlExecutionContext.create(context).getContext().req;
    const token = extractBearer(req);
    if (!token) throw new UnauthorizedException('Missing bearer token.');
    let payload: ConsumerTokenPayload;
    try {
      payload = this.tokens.verify<ConsumerTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token.');
    }
    if (payload.typ !== 'consumer') throw new UnauthorizedException('Consumer token required.');
    req.consumer = { id: payload.sub };
    return true;
  }
}
