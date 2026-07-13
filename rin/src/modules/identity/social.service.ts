import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConsumerCredential } from './consumer-credential.entity';
import { IdentityService } from './identity.service';
import { OidcVerifier } from './oidc-verifier';
import { Consumer } from './consumer.entity';

@Injectable()
export class SocialAuthService {
  constructor(
    @InjectRepository(ConsumerCredential)
    private readonly credentials: Repository<ConsumerCredential>,
    private readonly identity: IdentityService,
    private readonly verifier: OidcVerifier,
  ) {}

  /**
   * "Continue with Apple/Google" — verify the provider's ID token, then map it
   * to a Spark identity: reuse the linked one, link to an existing identity by
   * email, or create a fresh identity. Always the same human, one Spark id.
   */
  async login(provider: string, idToken: string): Promise<{ consumer: Consumer; isNew: boolean }> {
    const verified = await this.verifier.verify(provider, idToken);

    const existing = await this.credentials.findOne({
      where: { type: 'oauth', provider: verified.provider, subject: verified.subject },
    });
    if (existing) {
      return { consumer: await this.identity.findById(existing.consumerId), isNew: false };
    }

    if (!verified.email) {
      throw new BadRequestException('Provider did not supply an email; cannot create an identity.');
    }
    const before = await this.identity.findByEmail(verified.email);
    const consumer = await this.identity.findOrCreateByEmail(verified.email);
    await this.credentials.save(
      this.credentials.create({
        consumerId: consumer.id,
        type: 'oauth',
        provider: verified.provider,
        subject: verified.subject,
        label: `${verified.provider} login`,
      }),
    );
    return { consumer, isNew: !before };
  }
}
