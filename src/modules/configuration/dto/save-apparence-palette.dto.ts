import { IsHexColor, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SaveApparencePaletteDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  libelle!: string;

  @IsHexColor({ message: 'Couleur principale invalide' })
  primaryColor!: string;

  @IsHexColor({ message: 'Couleur secondaire invalide' })
  secondaryColor!: string;

  @IsHexColor({ message: 'Couleur de fond invalide' })
  backgroundColor!: string;

  @IsHexColor({ message: 'Couleur de texte invalide' })
  textColor!: string;
}
