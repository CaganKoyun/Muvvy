import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IdentityService } from './identity.service';
import { AuthTokenService } from '../../common/auth/auth-token.service';
import { ConsumerGuard } from '../../common/auth/consumer.guard';
import { CurrentConsumer } from '../../common/auth/current-user.decorator';
import { ConsumerPrincipal } from '../../common/auth/token.types';
import { LoginDto, RegisterDto, TokenResponse } from './dto';

/**
 * Spark consumer identity. This is the "Continue with Spark" side — the human's
 * single login reused across every merchant.
 */
@ApiTags('identity (consumer)')
@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly identity: IdentityService,
    private readonly tokens: AuthTokenService,
  ) {}

  @Post('register')
  @ApiOperation({ summary: 'Create a Spark identity.' })
  async register(@Body() dto: RegisterDto): Promise<TokenResponse> {
    const consumer = await this.identity.register(dto.email, dto.password, dto.phone);
    return this.tokenResponse(consumer.id);
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Authenticate a Spark identity (POST /identity/login).' })
  async login(@Body() dto: LoginDto): Promise<TokenResponse> {
    const consumer = await this.identity.validateCredentials(dto.email, dto.password);
    return this.tokenResponse(consumer.id);
  }

  @Get('me')
  @UseGuards(ConsumerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The current Spark identity.' })
  async me(@CurrentConsumer() principal: ConsumerPrincipal) {
    const consumer = await this.identity.findById(principal.id);
    return {
      id: consumer.id,
      email: consumer.email,
      phone: consumer.phone,
      status: consumer.status,
      createdAt: consumer.createdAt,
    };
  }

  private tokenResponse(consumerId: string): TokenResponse {
    const { accessToken, expiresIn } = this.tokens.signConsumer(consumerId);
    return { accessToken, tokenType: 'Bearer', expiresIn, consumerId };
  }
}
