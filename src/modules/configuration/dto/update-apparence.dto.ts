import { IsBoolean, IsHexColor, IsIn, IsOptional } from 'class-validator';

const THEME_COLORS = [
  'white',
  'black',
  'purple',
  'orange',
  'cyan',
  'green',
  'blue',
  'indigo',
  'teal',
  'red',
  'pink',
  'amber',
  'slate',
] as const;
const MODES = ['light', 'dark'] as const;

export class UpdateApparenceDto {
  @IsIn(THEME_COLORS, { message: `Couleur non supportée. Valeurs : ${THEME_COLORS.join(', ')}` })
  themeColor!: (typeof THEME_COLORS)[number];

  @IsIn(MODES, { message: 'Mode sidebar invalide. Valeurs : light, dark' })
  sidebarMode!: (typeof MODES)[number];

  @IsIn(MODES, { message: "Mode d'affichage invalide. Valeurs : light, dark" })
  displayMode!: (typeof MODES)[number];

  @IsOptional()
  @IsHexColor({ message: 'Couleur principale invalide' })
  primaryColor?: string;

  @IsOptional()
  @IsHexColor({ message: 'Couleur secondaire invalide' })
  secondaryColor?: string;

  @IsOptional()
  @IsHexColor({ message: 'Couleur de fond invalide' })
  backgroundColor?: string;

  @IsOptional()
  @IsHexColor({ message: 'Couleur de texte invalide' })
  textColor?: string;

  @IsOptional()
  @IsBoolean()
  reset?: boolean;
}
