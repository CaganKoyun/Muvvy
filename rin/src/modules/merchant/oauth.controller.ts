import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MerchantService } from './merchant.service';
import { AuthTokenService } from '../../common/auth/auth-token.service';
import { OAuthTokenDto } from './dto';

/** OAuth2 token endpoint — merchants exchange client credentials for a token. */
@ApiTags('identity (merchant)')
@Controller('oauth')
export class OAuthController {
  constructor(
    private readonly merchants: MerchantService,
    private readonly tokens: AuthTokenService,
  ) {}

  @Post('token')
  @HttpCode(200)
  @ApiOperation({ summary: 'OAuth2 client_credentials grant → merchant access token.' })
  async token(@Body() dto: OAuthTokenDto) {
    const merchant = await this.merchants.validateClientCredentials(
      dto.client_id,
      dto.client_secret,
    );
    const { accessToken, expiresIn } = this.tokens.signMerchant(merchant.id);
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: expiresIn,
      merchant_id: merchant.id,
    };
  }
}
