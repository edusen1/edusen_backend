import { IsString, IsOptional, IsUUID, IsInt, Min, MaxLength, MinLength } from 'class-validator';

export class UpdateClasseDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  nom?: string;

  @IsOptional()
  @IsUUID()
  niveauId?: string;

  @IsOptional()
  @IsUUID()
  professeurResponsableId?: string | null;

  @IsOptional()
  @IsUUID()
  salleId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  effectifMax?: number | null;
}
