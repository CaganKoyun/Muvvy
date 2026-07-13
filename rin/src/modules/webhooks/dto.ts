import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsOptional, IsUrl } from 'class-validator';
import { EventType } from '../../common/events/domain-events';

const EVENT_VALUES = [...Object.values(EventType), '*'];

export class RegisterEndpointDto {
  @ApiProperty({ example: 'https://crm.lcwaikiki.example/hooks/spark' })
  @IsUrl({ require_tld: false })
  url!: string;

  @ApiPropertyOptional({
    description: 'Event types to subscribe to. Defaults to all ("*").',
    isArray: true,
    enum: EVENT_VALUES,
  })
  @IsOptional()
  @IsArray()
  @IsIn(EVENT_VALUES, { each: true })
  events?: string[];
}
