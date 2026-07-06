import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsObject, IsString } from 'class-validator';

export class PasskeyRegisterVerifyDto {
  @ApiProperty({ description: 'base64url attestationObject from the authenticator.' })
  @IsString()
  attestationObject!: string;

  @ApiProperty({ description: 'base64url clientDataJSON.' })
  @IsString()
  clientDataJSON!: string;
}

export class PasskeyLoginOptionsDto {
  @ApiProperty({ example: 'ahmet@example.com' })
  @IsString()
  email!: string;
}

export class PasskeyLoginVerifyDto {
  @ApiProperty({ example: 'ahmet@example.com' })
  @IsString()
  email!: string;

  @ApiProperty()
  @IsString()
  credentialId!: string;

  @ApiProperty({ description: 'base64url authenticatorData.' })
  @IsString()
  authenticatorData!: string;

  @ApiProperty({ description: 'base64url clientDataJSON.' })
  @IsString()
  clientDataJSON!: string;

  @ApiProperty({ description: 'base64url DER ECDSA signature.' })
  @IsString()
  signature!: string;
}

export class SocialLoginDto {
  @ApiProperty({ enum: ['demo', 'google', 'apple'], example: 'google' })
  @IsIn(['demo', 'google', 'apple'])
  provider!: string;

  @ApiProperty({ description: 'The provider ID token (JWT).' })
  @IsString()
  idToken!: string;
}
