import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Min,
  MaxLength,
  MinLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

const PAYS_SUPPORTES = ['SN', 'MR', 'GN', 'GW', 'ML'] as const;
const Trim = (): PropertyDecorator =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const OptionalTrim = (): PropertyDecorator =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  });
const OptionalNumber = (): PropertyDecorator =>
  Transform(({ value }) => {
    if (value === null || value === undefined || value === '') return undefined;
    const numberValue = Number(value);
    return Number.isNaN(numberValue) ? value : numberValue;
  });
const PHONE_RULES: Record<(typeof PAYS_SUPPORTES)[number], { indicatif: string; digits: number }> = {
  SN: { indicatif: '+221', digits: 9 },
  MR: { indicatif: '+222', digits: 8 },
  GN: { indicatif: '+224', digits: 9 },
  GW: { indicatif: '+245', digits: 7 },
  ML: { indicatif: '+223', digits: 8 },
};

const normalizePhoneValue = (
  value: unknown,
  obj: { pays?: (typeof PAYS_SUPPORTES)[number] },
): string => {
  if (typeof value !== 'string') return String(value ?? '');
  const cleaned = value.trim().replace(/[\s().-]/g, '');
  const country = obj.pays;
  const rule = country ? PHONE_RULES[country] : undefined;
  if (!rule) return cleaned;

  const digitsOnly = cleaned.replace(/^\+/, '');
  const prefixWithoutPlus = rule.indicatif.slice(1);
  if (digitsOnly.startsWith(prefixWithoutPlus)) {
    return `+${digitsOnly}`;
  }

  return `${rule.indicatif}${digitsOnly}`;
};

@ValidatorConstraint({ name: 'PhoneByCountry', async: false })
class PhoneByCountryConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as UpdateEcoleConfigDto;
    const rule = PHONE_RULES[dto.pays];
    if (typeof value !== 'string' || !rule) return false;

    const normalized = value.trim().replace(/[\s().-]/g, '');

    if (normalized.startsWith('+')) {
      const pattern = new RegExp(`^\\${rule.indicatif}\\d{${rule.digits}}$`);
      return pattern.test(normalized);
    }

    const localPattern = new RegExp(`^\\d{${rule.digits}}$`);
    return localPattern.test(normalized);
  }

  defaultMessage(): string {
    return 'Numéro de téléphone invalide pour le pays sélectionné';
  }
}

export class UpdateEcoleConfigDto {
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  nom!: string;

  @OptionalTrim()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  slogan?: string;

  @Trim()
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  adresse!: string;

  /** Lettres, espaces, apostrophes et tirets uniquement. */
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/^[a-zA-ZÀ-ÿ' -]+$/, { message: 'La ville ne doit contenir que des lettres' })
  ville!: string;

  @IsIn(PAYS_SUPPORTES, { message: `Pays non supporté. Valeurs : ${PAYS_SUPPORTES.join(', ')}` })
  pays!: (typeof PAYS_SUPPORTES)[number];

  /** Chiffres, espaces, +, -, (, ), . uniquement */
  @Transform(({ value, obj }) => normalizePhoneValue(value, obj))
  @Trim()
  @IsString()
  @Matches(/^[\d\s+\-().]{7,25}$/, { message: 'Numéro de téléphone invalide' })
  @Validate(PhoneByCountryConstraint)
  telephone!: string;

  @Trim()
  @IsEmail({}, { message: 'Adresse email invalide' })
  @MaxLength(254)
  email!: string;

  @OptionalTrim()
  @IsOptional()
  @IsUrl({ require_tld: true, require_protocol: true }, { message: 'URL du site web invalide' })
  @MaxLength(500)
  siteWeb?: string;

  @OptionalTrim()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  numeroAgrement?: string;

  @OptionalNumber()
  @IsOptional()
  @IsNumber({}, { message: 'Montant horaire par défaut invalide' })
  @Min(0, { message: 'Le montant horaire par défaut doit être positif' })
  montantHoraireDefaut?: number;

  @OptionalTrim()
  @IsOptional()
  @IsString()
  @MaxLength(2_000_000)
  @Matches(/^(https?:\/\/|data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,).+/i, { message: 'Logo invalide' })
  logoUrl?: string;
}
