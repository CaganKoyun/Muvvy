import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class GqlAddress {
  @Field({ nullable: true }) line1?: string;
  @Field({ nullable: true }) city?: string;
  @Field({ nullable: true }) postalCode?: string;
  @Field({ nullable: true }) country?: string;
}

@ObjectType()
export class GqlProfile {
  @Field({ nullable: true }) firstName?: string;
  @Field({ nullable: true }) lastName?: string;
  @Field({ nullable: true }) birthday?: string;
  @Field({ nullable: true }) gender?: string;
  @Field(() => GqlAddress, { nullable: true }) address?: GqlAddress;
}

@ObjectType()
export class GqlGrant {
  @Field() grantId!: string;
  @Field() merchantName!: string;
  @Field() status!: string;
  @Field(() => [String]) grantedScopes!: string[];
}

@ObjectType()
export class GqlNotification {
  @Field() id!: string;
  @Field() type!: string;
  @Field() title!: string;
  @Field({ nullable: true }) body?: string;
  @Field() read!: boolean;
}

@ObjectType()
export class GqlWalletSummary {
  @Field(() => Int) receipts!: number;
  @Field(() => Int) warranties!: number;
  @Field(() => Int) giftCards!: number;
  @Field(() => Int) coupons!: number;
  @Field(() => Int) loyaltyCards!: number;
  @Field(() => Int) membershipCards!: number;
}

@ObjectType()
export class GqlMe {
  @Field() id!: string;
  @Field() email!: string;
  @Field(() => GqlProfile, { nullable: true }) profile?: GqlProfile;
  @Field(() => [GqlGrant]) grants!: GqlGrant[];
  @Field(() => [GqlNotification]) notifications!: GqlNotification[];
  @Field(() => GqlWalletSummary) wallet!: GqlWalletSummary;
}
