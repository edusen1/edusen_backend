import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  slug!: string;

  @IsString()
  nom!: string;

  @IsOptional()
  @IsString()
  emailContact?: string;

  @IsOptional()
  @IsString()
  telephone?: string;

  @IsOptional()
  @IsString()
  adresse?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsBoolean()
  actif?: boolean;
}
