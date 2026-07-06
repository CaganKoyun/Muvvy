import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ALL_SCOPE_KEYS } from '../../common/scopes';

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
