import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateConnectorDto {
  @ApiProperty({ enum: ['crm', 'pos', 'erp'] })
  @IsIn(['crm', 'pos', 'erp'])
  kind!: 'crm' | 'pos' | 'erp';

  @ApiProperty({
    enum: ['log', 'rest'],
    description: "'log' records syncs locally (demo); 'rest' POSTs to config.url.",
  })
  @IsIn(['log', 'rest'])
  adapter!: 'log' | 'rest';

  @ApiProperty({ example: 'Salesforce (prod)' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ example: { url: 'https://crm.example/ingest', apiKey: '••••' } })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Mark this as the brand’s primary solution.' })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
