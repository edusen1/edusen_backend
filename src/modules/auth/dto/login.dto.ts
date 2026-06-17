import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ description: 'Téléphone, matricule, email ou username' })
  @IsOptional()
  @IsString()
  telephone?: string;

  @ApiPropertyOptional({ description: 'Alias moderne de telephone pour les backoffices' })
  @IsOptional()
  @IsString()
  login?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  password!: string;
}
