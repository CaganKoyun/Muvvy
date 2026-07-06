import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ConsumerPrincipal, MerchantPrincipal } from './token.types';

/** Injects the authenticated consumer (set by ConsumerGuard). */
export const CurrentConsumer = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ConsumerPrincipal => {
    return ctx.switchToHttp().getRequest().consumer;
  },
);

/** Injects the authenticated merchant tenant (set by MerchantGuard). */
export const CurrentMerchant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): MerchantPrincipal => {
    return ctx.switchToHttp().getRequest().merchant;
  },
);
