import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ description: 'Téléphone, matricule, email ou username' })
  @IsString()
  @IsNotEmpty()
  telephone!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  password!: string;
}
