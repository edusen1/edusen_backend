import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ description: 'Téléphone ou matricule élève' })
  @IsString()
  @IsNotEmpty()
  telephone!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  password!: string;

  @ApiProperty({ required: false, description: 'Code d\'accès opaque (staff ou élève)' })
  @IsOptional()
  @IsString()
  code?: string;

}
