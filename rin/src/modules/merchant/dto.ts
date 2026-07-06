import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsHexColor,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  ValidateNested,
} from 'class-validator';
import { ALL_SCOPE_KEYS } from '../../common/scopes';

export class CreateBranchDto {
  @ApiProperty({ example: 'LC Waikiki Akasya' })
  @IsString()
  name!: string;

  @ApiProperty({ example: 'AKASYA' })
  @IsString()
  code!: string;

  @ApiPropertyOptional({ example: 'İstanbul' })
  @IsOptional()
  @IsString()
  city?: string;
}

export class UpdateBrandingDto {
  @ApiPropertyOptional({ example: 'LC Waikiki' })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example/lcw-logo.png' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  logoUrl?: string;

  @ApiPropertyOptional({ example: '#0057B8' })
  @IsOptional()
  @IsHexColor()
  primaryColor?: string;

  @ApiPropertyOptional({ example: 'https://app.lcwaikiki.com/welcome' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  postConsentRedirectUrl?: string;
}

export class OAuthTokenDto {
  @ApiProperty({ example: 'client_credentials' })
  @IsIn(['client_credentials'])
  grant_type!: string;

  @ApiProperty({ example: 'spark_client_lcw_xxx' })
  @IsString()
  client_id!: string;

  @ApiProperty({ example: 'secret_xxx' })
  @IsString()
  client_secret!: string;
}

export class RequestedFieldDto {
  @ApiProperty({ enum: ALL_SCOPE_KEYS, example: 'profile:email' })
  @IsIn(ALL_SCOPE_KEYS)
  scopeKey!: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  required!: boolean;
}

export class SetConsentConfigDto {
  @ApiProperty({ type: [RequestedFieldDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RequestedFieldDto)
  fields!: RequestedFieldDto[];
}
