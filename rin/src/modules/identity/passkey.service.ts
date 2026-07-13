import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ConsumerCredential } from './consumer-credential.entity';
import { WebAuthnChallenge } from './webauthn-challenge.entity';
import { IdentityService } from './identity.service';
import { Consumer } from './consumer.entity';
import { AppConfig } from '../../config/configuration';
import {
  randomChallenge,
  verifyAuthentication,
  verifyRegistration,
} from '../../common/webauthn/webauthn';

@Injectable()
export class PasskeyService {
  private readonly wa: AppConfig['webauthn'];

  constructor(
    @InjectRepository(ConsumerCredential)
    private readonly credentials: Repository<ConsumerCredential>,
    @InjectRepository(WebAuthnChallenge)
    private readonly challenges: Repository<WebAuthnChallenge>,
    private readonly identity: IdentityService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.wa = config.get('webauthn', { infer: true });
  }

  async registerOptions(consumerId: string) {
    const consumer = await this.identity.findById(consumerId);
    const challenge = await this.issueChallenge(consumerId, 'register');
    return {
      challenge,
      rp: { id: this.wa.rpId, name: this.wa.rpName },
      origin: this.wa.origin,
      user: { id: consumer.id, name: consumer.email, displayName: consumer.email },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      attestation: 'none',
      timeout: 60_000,
    };
  }

  async registerVerify(
    consumerId: string,
    body: { attestationObject: string; clientDataJSON: string },
  ) {
    const challenge = await this.consumeChallenge(consumerId, 'register');
    let result: ReturnType<typeof verifyRegistration>;
    try {
      result = verifyRegistration({
        rpId: this.wa.rpId,
        origin: this.wa.origin,
        expectedChallenge: challenge,
        clientDataJSON: body.clientDataJSON,
        attestationObject: body.attestationObject,
      });
    } catch (err) {
      throw new BadRequestException(`Passkey registration failed: ${(err as Error).message}`);
    }
    if (await this.credentials.findOne({ where: { credentialId: result.credentialId } })) {
      throw new ConflictException('This passkey is already registered.');
    }
    await this.credentials.save(
      this.credentials.create({
        consumerId,
        type: 'passkey',
        credentialId: result.credentialId,
        publicKeyJwk: result.publicKeyJwk,
        counter: result.counter,
        label: 'passkey',
      }),
    );
    return { credentialId: result.credentialId, registered: true };
  }

  async loginOptions(email: string) {
    const consumer = await this.identity.findByEmail(email);
    const challenge = await this.issueChallenge(normalize(email), 'login');
    const allowCredentials = consumer
      ? (
          await this.credentials.find({
            where: { consumerId: consumer.id, type: 'passkey' },
          })
        ).map((c) => ({ type: 'public-key', id: c.credentialId }))
      : [];
    return { challenge, rpId: this.wa.rpId, origin: this.wa.origin, allowCredentials };
  }

  async loginVerify(body: {
    email: string;
    credentialId: string;
    authenticatorData: string;
    clientDataJSON: string;
    signature: string;
  }): Promise<Consumer> {
    const consumer = await this.identity.findByEmail(body.email);
    if (!consumer) throw new UnauthorizedException('Unknown identity.');
    const cred = await this.credentials.findOne({
      where: { credentialId: body.credentialId, consumerId: consumer.id, type: 'passkey' },
    });
    if (!cred || !cred.publicKeyJwk) throw new UnauthorizedException('Unknown passkey.');

    const challenge = await this.consumeChallenge(normalize(body.email), 'login');
    let newCounter: number;
    try {
      ({ newCounter } = verifyAuthentication({
        rpId: this.wa.rpId,
        origin: this.wa.origin,
        expectedChallenge: challenge,
        clientDataJSON: body.clientDataJSON,
        authenticatorData: body.authenticatorData,
        signature: body.signature,
        publicKeyJwk: cred.publicKeyJwk,
        storedCounter: cred.counter,
      }));
    } catch (err) {
      throw new UnauthorizedException(`Passkey login failed: ${(err as Error).message}`);
    }
    cred.counter = newCounter;
    await this.credentials.save(cred);
    return consumer;
  }

  // ── challenge lifecycle ──
  private async issueChallenge(subjectKey: string, kind: 'register' | 'login'): Promise<string> {
    const challenge = randomChallenge();
    await this.challenges.save(
      this.challenges.create({
        subjectKey,
        kind,
        challenge,
        expiresAt: new Date(Date.now() + 5 * 60_000),
      }),
    );
    return challenge;
  }

  private async consumeChallenge(subjectKey: string, kind: 'register' | 'login'): Promise<string> {
    const row = await this.challenges.findOne({
      where: { subjectKey, kind },
      order: { createdAt: 'DESC' },
    });
    if (!row) throw new BadRequestException('No active challenge. Request options first.');
    const challenge = row.challenge;
    const expired = row.expiresAt.getTime() < Date.now();
    await this.challenges.delete({ subjectKey, kind });
    if (expired) throw new BadRequestException('Challenge expired. Please retry.');
    return challenge;
  }
}

function normalize(email: string): string {
  return email.trim().toLowerCase();
}
