import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
} from 'class-validator';
import { ALL_SCOPE_KEYS } from '../../common/scopes';

export class CreateIdentityRequestDto {
  @ApiPropertyOptional({
    description:
      'Override the scopes for this request. Defaults to the merchant Consent Engine config.',
    isArray: true,
    enum: ALL_SCOPE_KEYS,
  })
  @IsOptional()
  @IsArray()
  @IsIn(ALL_SCOPE_KEYS, { each: true })
  requestedScopes?: string[];

  @ApiPropertyOptional({ isArray: true, enum: ALL_SCOPE_KEYS })
  @IsOptional()
  @IsArray()
  @IsIn(ALL_SCOPE_KEYS, { each: true })
  requiredScopes?: string[];

  @ApiPropertyOptional({ description: 'Merchant-side reference, e.g. POS transaction id.' })
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional({ description: 'The branch (şube) generating this QR.' })
  @IsOptional()
  @IsString()
  branchId?: string;
}

export class ApproveRequestDto {
  @ApiProperty({
    description: 'The scopes the customer chooses to grant. Must include all required scopes.',
    isArray: true,
    enum: ALL_SCOPE_KEYS,
    example: ['profile:email', 'profile:phone', 'permission:marketing'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(ALL_SCOPE_KEYS, { each: true })
  grantedScopes!: string[];
}
