export type CoefficientRow = {
  matiereId: string;
  coefficient?: number | null;
};

export type SerieCoefficientRow = CoefficientRow & {
  serie?: string | null;
};

export function normalizeSerie(value: unknown): string | null {
  const serie = String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');
  return serie || null;
}

export function resolveClassCoefficients(input: {
  serie?: string | null;
  matiereNiveaux?: SerieCoefficientRow[];
  cours?: CoefficientRow[];
}): Map<string, number> {
  const resolved = new Map<string, number>();
  const classSerie = normalizeSerie(input.serie);

  for (const row of input.cours ?? []) {
    resolved.set(row.matiereId, row.coefficient ?? 1);
  }

  for (const row of input.matiereNiveaux ?? []) {
    if (!normalizeSerie(row.serie)) {
      resolved.set(row.matiereId, row.coefficient ?? 1);
    }
  }

  if (classSerie) {
    for (const row of input.matiereNiveaux ?? []) {
      if (normalizeSerie(row.serie) === classSerie) {
        resolved.set(row.matiereId, row.coefficient ?? 1);
      }
    }
  }

  return resolved;
}
