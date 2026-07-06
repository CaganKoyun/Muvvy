import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { ALL_SCOPE_KEYS } from '../../common/scopes';

export class CreateCampaignDto {
  @ApiProperty({ example: 'Yaz İndirimi Başladı 🌞' })
  @IsString()
  title!: string;

  @ApiPropertyOptional({ example: 'Tüm denim ürünlerde %30 indirim, sadece bu hafta.' })
  @IsOptional()
  @IsString()
  body?: string;

  @ApiPropertyOptional({
    description: 'Scope a customer must have granted to be eligible. Default: permission:marketing.',
    enum: ALL_SCOPE_KEYS,
  })
  @IsOptional()
  @IsIn(ALL_SCOPE_KEYS)
  requireScope?: string;
}

export class UpsertMembershipDto {
  @ApiProperty({ description: 'The customer, identified by the consent grant id.' })
  @IsString()
  grantId!: string;

  @ApiPropertyOptional({ example: 'gold' })
  @IsOptional()
  @IsString()
  tier?: string;

  @ApiPropertyOptional({ example: 150, description: 'Points to add.' })
  @IsOptional()
  @IsInt()
  addPoints?: number;
}
