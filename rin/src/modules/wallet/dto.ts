import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class ReceiptItemDto {
  @ApiProperty({ example: 'Erkek Kot Pantolon' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ example: 'LCW-1234' })
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ description: 'Unit price in minor units (kuruş).', example: 79999 })
  @IsInt()
  @Min(0)
  unitPriceMinor!: number;

  @ApiPropertyOptional({ example: 24, description: 'Warranty length in months.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  warrantyMonths?: number;

  @ApiPropertyOptional({ example: 30, description: 'Return window in days.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  returnDays?: number;
}

export class UploadReceiptDto {
  @ApiProperty({ description: 'The customer, identified by the consent grant id.' })
  @IsString()
  grantId!: string;

  @ApiPropertyOptional({ example: 'POS-2026-99881' })
  @IsOptional()
  @IsString()
  externalId?: string;

  @ApiPropertyOptional({ example: 'LC Waikiki Akasya' })
  @IsOptional()
  @IsString()
  storeName?: string;

  @ApiPropertyOptional({ example: 'TRY' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ example: '2026-07-06T12:00:00.000Z' })
  @IsISO8601()
  purchasedAt!: string;

  @ApiProperty({ type: [ReceiptItemDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ReceiptItemDto)
  items!: ReceiptItemDto[];
}

export class IssueWalletItemDto {
  @ApiProperty({ description: 'The customer, identified by the consent grant id.' })
  @IsString()
  grantId!: string;

  @ApiProperty({ enum: ['gift_card', 'coupon', 'loyalty_card', 'membership_card'] })
  @IsIn(['gift_card', 'coupon', 'loyalty_card', 'membership_card'])
  type!: 'gift_card' | 'coupon' | 'loyalty_card' | 'membership_card';

  @ApiProperty({ example: '20% Yaz İndirimi' })
  @IsString()
  title!: string;

  @ApiPropertyOptional({ example: 'SUMMER20' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({ example: 10000, description: 'Balance in minor units.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  balanceMinor?: number;

  @ApiPropertyOptional({ example: 'TRY' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59.000Z' })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}
