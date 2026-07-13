import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ConsumerResolver } from './consumer.resolver';
import { GqlConsumerGuard } from './gql-consumer.guard';
import { IdentityModule } from '../identity/identity.module';
import { ProfileModule } from '../profile/profile.module';
import { ConsentModule } from '../consent/consent.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      sortSchema: true,
      path: '/graphql',
      context: ({ req }: { req: unknown }) => ({ req }),
    }),
    IdentityModule,
    ProfileModule,
    ConsentModule,
    NotificationsModule,
    WalletModule,
  ],
  providers: [ConsumerResolver, GqlConsumerGuard],
})
export class RinGraphqlModule {}
