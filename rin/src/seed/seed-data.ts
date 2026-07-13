import { INestApplicationContext } from '@nestjs/common';
import { MerchantService } from '../modules/merchant/merchant.service';
import { IdentityService } from '../modules/identity/identity.service';
import { ProfileService } from '../modules/profile/profile.service';
import { MallService } from '../modules/mall/mall.service';
import { SCOPES } from '../common/scopes';

export interface SeedResult {
  merchant: { id: string; name: string; slug: string; clientId: string; clientSecret: string };
  branch: { id: string; name: string; code: string };
  consumer: { id: string; email: string; password: string };
  mall: { id: string; name: string };
}

/**
 * Shared seeding routine used by both the standalone `seed` script and the
 * in-process `demo`. Seeds one retailer (LC Waikiki) with a Consent Engine
 * config matching the PRD example, and one customer (Ahmet) with a full profile.
 */
export async function seed(app: INestApplicationContext): Promise<SeedResult> {
  const merchants = app.get(MerchantService);
  const identity = app.get(IdentityService);
  const profiles = app.get(ProfileService);
  const malls = app.get(MallService);

  const merchant = await merchants.create('LC Waikiki', 'lc-waikiki', 'fashion');
  const cred = await merchants.issueCredentials(merchant.id);
  await merchants.updateBranding(merchant.id, {
    displayName: 'LC Waikiki',
    logoUrl: 'https://logo.clearbit.com/lcwaikiki.com',
    primaryColor: '#0057B8',
    postConsentRedirectUrl: 'https://app.lcwaikiki.com/welcome',
  });
  const branch = await merchants.createBranch(merchant.id, {
    name: 'LC Waikiki Akasya',
    code: 'AKASYA',
    city: 'İstanbul',
  });

  // A mall the merchant participates in, so the mall dashboard has data.
  const mall = await malls.createMall('Akasya AVM', 'akasya', 'İstanbul');
  await malls.addStore(mall.id, merchant.id);
  await merchants.setRequestedFields(merchant.id, [
    // Required (PRD example): Phone, Email, Marketing
    { scopeKey: SCOPES.PROFILE_EMAIL, required: true },
    { scopeKey: SCOPES.PROFILE_PHONE, required: true },
    { scopeKey: SCOPES.PERM_MARKETING, required: true },
    // Optional: Birthday, Gender, Address
    { scopeKey: SCOPES.PROFILE_BIRTHDAY, required: false },
    { scopeKey: SCOPES.PROFILE_GENDER, required: false },
    { scopeKey: SCOPES.PROFILE_ADDRESS, required: false },
  ]);

  const password = 'sparkpass123';
  const consumer = await identity.register('ahmet@example.com', password, '+905551112233');
  await profiles.upsert(consumer.id, {
    firstName: 'Ahmet',
    lastName: 'Yılmaz',
    birthday: '1990-05-14',
    gender: 'male',
    address: { line1: 'Bağdat Cad. 12', city: 'İstanbul', postalCode: '34710', country: 'TR' },
  });

  return {
    merchant: {
      id: merchant.id,
      name: merchant.name,
      slug: merchant.slug,
      clientId: cred.clientId,
      clientSecret: cred.clientSecret,
    },
    branch: { id: branch.id, name: branch.name, code: branch.code },
    consumer: { id: consumer.id, email: consumer.email, password },
    mall: { id: mall.id, name: mall.name },
  };
}
