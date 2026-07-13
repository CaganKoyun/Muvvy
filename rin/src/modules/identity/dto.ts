import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'ahmet@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'sparkpass123', minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiPropertyOptional({ example: '+905551112233' })
  @IsOptional()
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'phone must be E.164-ish digits' })
  phone?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'ahmet@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'sparkpass123' })
  @IsString()
  password!: string;
}

export class TokenResponse {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType!: string;

  @ApiProperty({ example: 3600 })
  expiresIn!: number;

  @ApiProperty()
  consumerId!: string;
}
