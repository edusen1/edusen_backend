import { IsString, MinLength } from 'class-validator';
import { PASSWORD_MIN_LENGTH } from '../auth.constants';

export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: 'MOT_DE_PASSE_TROP_COURT' })
  newPassword!: string;
}
