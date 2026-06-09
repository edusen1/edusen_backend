const PHONE_RULES = {
  SN: { indicatif: '+221', digits: 9 },
  MR: { indicatif: '+222', digits: 8 },
  GN: { indicatif: '+224', digits: 9 },
  GW: { indicatif: '+245', digits: 7 },
  ML: { indicatif: '+223', digits: 8 },
} as const;

export type SupportedSchoolCountry = keyof typeof PHONE_RULES;

export function normalizeSchoolCountry(value?: string | null): SupportedSchoolCountry {
  const country = String(value ?? '').trim().toUpperCase() as SupportedSchoolCountry;
  return country in PHONE_RULES ? country : 'SN';
}

export function normalizePhoneForCountry(
  value: unknown,
  countryValue?: string | null,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;

  const raw = String(value).trim();
  if (!raw) return null;

  const country = normalizeSchoolCountry(countryValue);
  const rule = PHONE_RULES[country];
  const compact = raw.replace(/[\s().-]/g, '');
  const noPlus = compact.replace(/^\+/, '');

  for (const candidateRule of Object.values(PHONE_RULES)) {
    const prefix = candidateRule.indicatif.slice(1);
    if (noPlus.startsWith(prefix) && noPlus.length === prefix.length + candidateRule.digits) {
      return `+${noPlus}`;
    }
    if (noPlus.startsWith(`00${prefix}`) && noPlus.length === prefix.length + candidateRule.digits + 2) {
      return `+${noPlus.slice(2)}`;
    }
  }

  const digitsOnly = compact.replace(/\D/g, '');
  if (!digitsOnly) return null;

  if (digitsOnly.length === rule.digits) {
    return `${rule.indicatif}${digitsOnly}`;
  }

  const ownPrefix = rule.indicatif.slice(1);
  if (digitsOnly.startsWith(ownPrefix) && digitsOnly.length === ownPrefix.length + rule.digits) {
    return `+${digitsOnly}`;
  }

  if (digitsOnly.startsWith(`00${ownPrefix}`) && digitsOnly.length === ownPrefix.length + rule.digits + 2) {
    return `+${digitsOnly.slice(2)}`;
  }

  return compact.startsWith('+') ? compact : digitsOnly;
}

export function buildPhoneLoginVariants(login: string): string[] {
  const trimmed = String(login ?? '').trim();
  if (!trimmed || !/^[+\d\s().-]+$/.test(trimmed)) {
    return [];
  }

  const compact = trimmed.replace(/[\s().-]/g, '');
  const digits = compact.replace(/\D/g, '');
  if (digits.length < 7) {
    return [];
  }

  const variants = new Set<string>([trimmed, compact, digits]);

  for (const rule of Object.values(PHONE_RULES)) {
    const prefix = rule.indicatif.slice(1);
    let local = '';

    if (digits.startsWith(`00${prefix}`) && digits.length === prefix.length + rule.digits + 2) {
      local = digits.slice(prefix.length + 2);
    } else if (digits.startsWith(prefix) && digits.length === prefix.length + rule.digits) {
      local = digits.slice(prefix.length);
    } else if (digits.length === rule.digits) {
      local = digits;
    }

    if (!local || local.length !== rule.digits) continue;

    variants.add(local);
    variants.add(`${rule.indicatif}${local}`);
    variants.add(`${prefix}${local}`);
    variants.add(`00${prefix}${local}`);
  }

  return [...variants];
}
