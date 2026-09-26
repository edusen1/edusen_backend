import { IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { PASSWORD_MIN_LENGTH } from '../auth.constants';

export class ChangePasswordDto {
  @IsOptional()
  @IsString()
  currentPassword?: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: 'MOT_DE_PASSE_TROP_COURT' })
  @Matches(/[A-Z]/, { message: 'MOT_DE_PASSE_MAJUSCULE_REQUISE' })
  @Matches(/[a-z]/, { message: 'MOT_DE_PASSE_MINUSCULE_REQUISE' })
  @Matches(/[0-9]/, { message: 'MOT_DE_PASSE_CHIFFRE_REQUIS' })
  @Matches(/[^A-Za-z0-9]/, { message: 'MOT_DE_PASSE_CARACTERE_SPECIAL_REQUIS' })
  newPassword!: string;
}
