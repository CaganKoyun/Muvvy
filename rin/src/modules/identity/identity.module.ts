import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Consumer } from './consumer.entity';
import { ConsumerCredential } from './consumer-credential.entity';
import { WebAuthnChallenge } from './webauthn-challenge.entity';
import { IdentityService } from './identity.service';
import { PasskeyService } from './passkey.service';
import { SocialAuthService } from './social.service';
import { OidcVerifier } from './oidc-verifier';
import { AuthController } from './auth.controller';
import { IdentityMethodsController } from './identity-methods.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Consumer, ConsumerCredential, WebAuthnChallenge]),
  ],
  controllers: [AuthController, IdentityMethodsController],
  providers: [IdentityService, PasskeyService, SocialAuthService, OidcVerifier],
  exports: [IdentityService],
})
export class IdentityModule {}
