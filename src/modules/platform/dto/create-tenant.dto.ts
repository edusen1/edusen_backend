import { IsBoolean, IsEmail, IsInt, IsOptional, IsString } from 'class-validator';

export class CreateTenantDto {
  @IsOptional()
  @IsString()
  slug?: string;

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
  @IsString()
  plan?: string;

  @IsOptional()
  @IsInt()
  durationMonths?: number;

  @IsOptional()
  @IsEmail()
  initialAdminEmail?: string;

  @IsOptional()
  @IsString()
  initialAdminTelephone?: string;

  @IsOptional()
  @IsBoolean()
  actif?: boolean;
}
