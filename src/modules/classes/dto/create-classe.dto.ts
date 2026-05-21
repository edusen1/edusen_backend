import { IsString, IsOptional, IsUUID, IsInt, Min, MaxLength, MinLength } from 'class-validator';

export class CreateClasseDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  nom!: string;

  @IsUUID()
  niveauId!: string;

  @IsUUID()
  anneeAcademiqueId!: string;

  @IsOptional()
  @IsUUID()
  professeurResponsableId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  effectifMax?: number;
}
