import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PasskeyService } from './passkey.service';
import { SocialAuthService } from './social.service';
import { AuthTokenService } from '../../common/auth/auth-token.service';
import { ConsumerGuard } from '../../common/auth/consumer.guard';
import { CurrentConsumer } from '../../common/auth/current-user.decorator';
import { ConsumerPrincipal } from '../../common/auth/token.types';
import { TokenResponse } from './dto';
import {
  PasskeyLoginOptionsDto,
  PasskeyLoginVerifyDto,
  PasskeyRegisterVerifyDto,
  SocialLoginDto,
} from './identity-methods.dto';

@ApiTags('identity (consumer)')
@Controller('v1/auth')
export class IdentityMethodsController {
  constructor(
    private readonly passkeys: PasskeyService,
    private readonly social: SocialAuthService,
    private readonly tokens: AuthTokenService,
  ) {}

  // ── Passkey registration (must be signed in to add a passkey) ──
  @Post('passkey/register/options')
  @UseGuards(ConsumerGuard)
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({ summary: 'Begin passkey registration (WebAuthn create options).' })
  async registerOptions(@CurrentConsumer() c: ConsumerPrincipal) {
    return this.passkeys.registerOptions(c.id);
  }

  @Post('passkey/register/verify')
  @UseGuards(ConsumerGuard)
  @ApiBearerAuth()
  @HttpCode(201)
  @ApiOperation({ summary: 'Finish passkey registration.' })
  async registerVerify(
    @CurrentConsumer() c: ConsumerPrincipal,
    @Body() dto: PasskeyRegisterVerifyDto,
  ) {
    return this.passkeys.registerVerify(c.id, dto);
  }

  // ── Passkey login (passwordless) ──
  @Post('passkey/login/options')
  @HttpCode(200)
  @ApiOperation({ summary: 'Begin passkey login (WebAuthn get options).' })
  async loginOptions(@Body() dto: PasskeyLoginOptionsDto) {
    return this.passkeys.loginOptions(dto.email);
  }

  @Post('passkey/login/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Finish passkey login → Spark access token.' })
  async loginVerify(@Body() dto: PasskeyLoginVerifyDto): Promise<TokenResponse> {
    const consumer = await this.passkeys.loginVerify(dto);
    return this.token(consumer.id);
  }

  // ── Social login ──
  @Post('social')
  @HttpCode(200)
  @ApiOperation({ summary: 'Continue with Apple/Google (or demo) → Spark access token.' })
  async socialLogin(@Body() dto: SocialLoginDto): Promise<TokenResponse> {
    const { consumer } = await this.social.login(dto.provider, dto.idToken);
    return this.token(consumer.id);
  }

  private token(consumerId: string): TokenResponse {
    const { accessToken, expiresIn } = this.tokens.signConsumer(consumerId);
    return { accessToken, tokenType: 'Bearer', expiresIn, consumerId };
  }
}
