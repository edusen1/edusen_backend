import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ description: 'Email, username ou téléphone' })
  @IsString()
  @IsNotEmpty()
  login!: string;

  /** Alias email accepté pour rétro-compatibilité */
  @IsOptional()
  @IsString()
  email?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  password!: string;
}
