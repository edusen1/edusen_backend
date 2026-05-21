import { IsBoolean } from 'class-validator';

export class UpdateWhatsappFeaturesDto {
  @IsBoolean()
  otp!: boolean;

  @IsBoolean()
  payment!: boolean;

  @IsBoolean()
  absence!: boolean;

  @IsBoolean()
  bulletin!: boolean;
}
