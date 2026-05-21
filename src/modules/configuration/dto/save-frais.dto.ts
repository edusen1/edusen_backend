import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class FraisNiveauItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  section!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  niveau!: string;

  @IsNumber()
  @Min(0)
  inscription!: number;

  @IsNumber()
  @Min(0)
  mensualite!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  nbMois!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  moisDebut?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  moisFin?: number;

  @IsOptional()
  @IsBoolean()
  actif?: boolean;
}

export class SaveFraisDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FraisNiveauItemDto)
  frais!: FraisNiveauItemDto[];
}
