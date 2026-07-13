import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConsumerProfile } from './consumer-profile.entity';
import { UpdateProfileDto } from './dto';
import { IdentityService } from '../identity/identity.service';
import { SCOPES } from '../../common/scopes';

/** The shape a merchant receives — only ever the granted slice. */
export interface DisclosedData {
  profile: Record<string, unknown>;
  permissions: Record<string, boolean>;
}

@Injectable()
export class ProfileService {
  constructor(
    @InjectRepository(ConsumerProfile)
    private readonly repo: Repository<ConsumerProfile>,
    private readonly identity: IdentityService,
  ) {}

  async get(consumerId: string): Promise<ConsumerProfile | null> {
    return this.repo.findOne({ where: { consumerId } });
  }

  async upsert(consumerId: string, dto: UpdateProfileDto): Promise<ConsumerProfile> {
    let profile = await this.repo.findOne({ where: { consumerId } });
    if (!profile) {
      profile = this.repo.create({ consumerId });
    }
    if (dto.firstName !== undefined) profile.firstName = dto.firstName;
    if (dto.lastName !== undefined) profile.lastName = dto.lastName;
    if (dto.birthday !== undefined) profile.birthday = dto.birthday;
    if (dto.gender !== undefined) profile.gender = dto.gender;
    if (dto.address !== undefined) profile.address = dto.address;
    return this.repo.save(profile);
  }

  /**
   * Project the customer's data down to exactly the granted scopes. This is the
   * privacy boundary: a merchant physically cannot receive a field it was not
   * granted, because unnamed scopes are never read here.
   */
  async resolveDisclosure(consumerId: string, grantedScopes: string[]): Promise<DisclosedData> {
    const granted = new Set(grantedScopes);
    const profile = await this.repo.findOne({ where: { consumerId } });
    const consumer = await this.identity.findById(consumerId);

    const out: DisclosedData = { profile: {}, permissions: {} };

    if (granted.has(SCOPES.PROFILE_NAME)) {
      out.profile.name = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || null;
    }
    if (granted.has(SCOPES.PROFILE_EMAIL)) {
      out.profile.email = consumer.email;
    }
    if (granted.has(SCOPES.PROFILE_PHONE)) {
      out.profile.phone = consumer.phone;
    }
    if (granted.has(SCOPES.PROFILE_BIRTHDAY)) {
      out.profile.birthday = profile?.birthday ?? null;
    }
    if (granted.has(SCOPES.PROFILE_GENDER)) {
      out.profile.gender = profile?.gender ?? null;
    }
    if (granted.has(SCOPES.PROFILE_ADDRESS)) {
      out.profile.address = profile?.address ?? null;
    }

    for (const perm of [
      SCOPES.PERM_MARKETING,
      SCOPES.PERM_SMS,
      SCOPES.PERM_LOCATION,
      SCOPES.PERM_ANALYTICS,
    ]) {
      if (granted.has(perm)) {
        out.permissions[perm.split(':')[1]] = true;
      }
    }

    return out;
  }
}
