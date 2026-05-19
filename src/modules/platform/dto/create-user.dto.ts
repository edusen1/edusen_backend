import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { RolePlateforme, UserRole } from '@prisma/client';

export class CreateUserDto {
  @IsString()
  nom!: string;

  @IsString()
  prenom!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsEnum(RolePlateforme)
  rolePlateforme?: RolePlateforme;

  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsString()
  telephone?: string;
}
