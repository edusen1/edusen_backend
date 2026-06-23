export interface DebtPaymentRow {
  eleveId: string;
  montant: number;
  anneeScolaire: string;
  trimestre?: string | null;
  description?: string | null;
  reference?: string | null;
  statut?: string | null;
  createdAt?: Date;
}

export interface DebtMonthItem {
  anneeScolaire: string;
  code: string;
  label: string;
  montant: number;
  reference?: string | null;
  statut?: string | null;
  createdAt?: string | null;
}

export interface DebtYearItem {
  anneeScolaire: string;
  total: number;
  mois: DebtMonthItem[];
}

export interface DebtSummary {
  eleveId: string;
  totalDue: number;
  totalMonths: number;
  annees: DebtYearItem[];
  moisImpayes: DebtMonthItem[];
}

export interface DebtDashboardItem {
  eleveId: string;
  nom: string;
  matricule?: string | null;
  totalDue: number;
  totalMonths: number;
  annees: DebtYearItem[];
}

export interface DebtDashboardSummary {
  elevesAvecDettes: number;
  montantTotalDettes: number;
  topDebiteurs: DebtDashboardItem[];
}

const MONTHS: Record<string, { order: number; label: string }> = {
  MOIS_01: { order: 1, label: 'Janvier' },
  MOIS_02: { order: 2, label: 'Février' },
  MOIS_03: { order: 3, label: 'Mars' },
  MOIS_04: { order: 4, label: 'Avril' },
  MOIS_05: { order: 5, label: 'Mai' },
  MOIS_06: { order: 6, label: 'Juin' },
  MOIS_07: { order: 7, label: 'Juillet' },
  MOIS_08: { order: 8, label: 'Août' },
  MOIS_09: { order: 9, label: 'Septembre' },
  MOIS_10: { order: 10, label: 'Octobre' },
  MOIS_11: { order: 11, label: 'Novembre' },
  MOIS_12: { order: 12, label: 'Décembre' },
};

function normalizeCode(value?: string | null): string {
  return String(value ?? '').trim().toUpperCase();
}

function parseMonthFromLabel(value?: string | null): { code: string; label: string; order: number } {
  const raw = normalizeCode(value);
  const byPrefix = raw.match(/^MOIS[_-](\d{1,2})$/);
  if (byPrefix) {
    const index = Math.min(12, Math.max(1, Number(byPrefix[1])));
    const key = `MOIS_${String(index).padStart(2, '0')}`;
    const month = MONTHS[key];
    return { code: key, label: month.label, order: month.order };
  }
  if (MONTHS[raw]) {
    return { code: raw, label: MONTHS[raw].label, order: MONTHS[raw].order };
  }
  if (!raw) {
    return { code: 'UNSPECIFIED', label: 'Paiement', order: 99 };
  }
  return { code: raw, label: value ?? raw, order: 99 };
}

export function describeDebtPayment(row: Pick<DebtPaymentRow, 'trimestre' | 'description'>): { code: string; label: string; order: number } {
  const candidate = row.trimestre?.trim() || row.description?.trim() || '';
  return parseMonthFromLabel(candidate);
}

function compareYearsDesc(a: string, b: string): number {
  return b.localeCompare(a, 'fr', { numeric: true, sensitivity: 'base' });
}

export function buildDebtSummary(rows: DebtPaymentRow[]): DebtSummary {
  const sortedRows = [...rows].sort((a, b) => {
    const yearOrder = compareYearsDesc(a.anneeScolaire, b.anneeScolaire);
    if (yearOrder !== 0) return yearOrder;
    const monthA = describeDebtPayment({ trimestre: a.trimestre, description: a.description });
    const monthB = describeDebtPayment({ trimestre: b.trimestre, description: b.description });
    if (monthA.order !== monthB.order) return monthA.order - monthB.order;
    return (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
  });

  const moisImpayes = sortedRows.map((row) => {
    const month = describeDebtPayment({ trimestre: row.trimestre, description: row.description });
    return {
      anneeScolaire: row.anneeScolaire,
      code: month.code,
      label: month.label,
      montant: Number(row.montant ?? 0),
      reference: row.reference ?? null,
      statut: row.statut ?? null,
      createdAt: row.createdAt?.toISOString?.() ?? null,
    };
  });

  const yearMap = new Map<string, DebtYearItem>();
  for (const month of moisImpayes) {
    const year = yearMap.get(month.anneeScolaire) ?? { anneeScolaire: month.anneeScolaire, total: 0, mois: [] };
    year.total += month.montant;
    year.mois.push(month);
    yearMap.set(month.anneeScolaire, year);
  }

  const annees = [...yearMap.values()].sort((a, b) => compareYearsDesc(a.anneeScolaire, b.anneeScolaire)).map((year) => ({
    ...year,
    mois: [...year.mois].sort((a, b) => {
      if (a.anneeScolaire !== b.anneeScolaire) return compareYearsDesc(a.anneeScolaire, b.anneeScolaire);
      const monthA = describeDebtPayment({ trimestre: a.code, description: a.label });
      const monthB = describeDebtPayment({ trimestre: b.code, description: b.label });
      if (monthA.order !== monthB.order) return monthA.order - monthB.order;
      return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
    }),
  }));

  return {
    eleveId: rows[0]?.eleveId ?? '',
    totalDue: moisImpayes.reduce((sum, row) => sum + row.montant, 0),
    totalMonths: moisImpayes.length,
    annees,
    moisImpayes,
  };
}

export function buildDebtDashboardSummary(rows: DebtPaymentRow[], students: Array<{ eleveId: string; nom: string; matricule?: string | null }>): DebtDashboardSummary {
  const byEleve = new Map<string, DebtPaymentRow[]>();
  for (const row of rows) {
    const list = byEleve.get(row.eleveId) ?? [];
    list.push(row);
    byEleve.set(row.eleveId, list);
  }

  const lookup = new Map(students.map((student) => [student.eleveId, student]));
  const topDebiteurs = [...byEleve.entries()]
    .map(([eleveId, values]) => {
      const summary = buildDebtSummary(values);
      const student = lookup.get(eleveId);
      return {
        eleveId,
        nom: student?.nom ?? 'Élève',
        matricule: student?.matricule ?? null,
        totalDue: summary.totalDue,
        totalMonths: summary.totalMonths,
        annees: summary.annees,
      } satisfies DebtDashboardItem;
    })
    .sort((a, b) => b.totalDue - a.totalDue || b.totalMonths - a.totalMonths || a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }))
    .slice(0, 5);

  return {
    elevesAvecDettes: byEleve.size,
    montantTotalDettes: [...byEleve.values()].reduce((sum, values) => sum + buildDebtSummary(values).totalDue, 0),
    topDebiteurs,
  };
}
