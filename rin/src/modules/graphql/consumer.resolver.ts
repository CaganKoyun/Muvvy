import { Context, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { GqlMe } from './types';
import { GqlConsumerGuard } from './gql-consumer.guard';
import { IdentityService } from '../identity/identity.service';
import { ProfileService } from '../profile/profile.service';
import { ConsentService } from '../consent/consent.service';
import { NotificationService } from '../notifications/notification.service';
import { WalletService } from '../wallet/wallet.service';

/**
 * A single consumer-facing GraphQL entry point — the mobile app fetches its
 * whole home screen (identity, profile, connected stores, notifications, wallet)
 * in one round trip, alongside the REST surface.
 */
@Resolver(() => GqlMe)
export class ConsumerResolver {
  constructor(
    private readonly identity: IdentityService,
    private readonly profiles: ProfileService,
    private readonly consent: ConsentService,
    private readonly notifications: NotificationService,
    private readonly wallet: WalletService,
  ) {}

  @Query(() => GqlMe, { description: 'Everything the signed-in customer needs, in one query.' })
  @UseGuards(GqlConsumerGuard)
  async me(@Context() ctx: any): Promise<GqlMe> {
    const consumerId: string = ctx.req.consumer.id;

    const [consumer, profile, grants, notifs, wallet, warranties] = await Promise.all([
      this.identity.findById(consumerId),
      this.profiles.get(consumerId),
      this.consent.listGrantsForConsumer(consumerId),
      this.notifications.list(consumerId),
      this.wallet.listWallet(consumerId),
      this.wallet.listWarranties(consumerId),
    ]);
    const receipts = await this.wallet.listReceipts(consumerId);

    return {
      id: consumer.id,
      email: consumer.email,
      profile: profile
        ? {
            firstName: profile.firstName ?? undefined,
            lastName: profile.lastName ?? undefined,
            birthday: profile.birthday ?? undefined,
            gender: profile.gender ?? undefined,
            address: profile.address ?? undefined,
          }
        : undefined,
      grants: grants.map((g) => ({
        grantId: g.grantId,
        merchantName: g.merchant.name,
        status: g.status,
        grantedScopes: g.grantedScopes,
      })),
      notifications: notifs.items.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body ?? undefined,
        read: n.read,
      })),
      wallet: {
        receipts: receipts.length,
        warranties: warranties.length,
        giftCards: wallet.giftCards.length,
        coupons: wallet.coupons.length,
        loyaltyCards: wallet.loyaltyCards.length,
        membershipCards: wallet.membershipCards.length,
      },
    };
  }
}
