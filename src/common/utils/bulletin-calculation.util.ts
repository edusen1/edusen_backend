export interface BulletinGradeInput {
  eleveId: string;
  matiereId: string;
  note: number;
  noteSur: number;
}

/**
 * Keeps the existing grading rule: each evaluation is weighted by its subject
 * coefficient, then the weighted mean is rounded to two decimals.
 */
export function calculateBulletinAverages(
  studentIds: readonly string[],
  notes: readonly BulletinGradeInput[],
  coefficients: ReadonlyMap<string, number>,
): Map<string, number> {
  const totals = new Map<string, { points: number; coefficients: number }>();

  for (const studentId of studentIds) {
    totals.set(studentId, { points: 0, coefficients: 0 });
  }

  for (const note of notes) {
    if (!Number.isFinite(note.note) || !Number.isFinite(note.noteSur) || note.noteSur <= 0) continue;
    const total = totals.get(note.eleveId);
    if (!total) continue;

    const coefficient = coefficients.get(note.matiereId) ?? 1;
    total.points += (note.note / note.noteSur) * 20 * coefficient;
    total.coefficients += coefficient;
  }

  return new Map(
    studentIds.map((studentId) => {
      const total = totals.get(studentId)!;
      const average = total.coefficients > 0 ? total.points / total.coefficients : 0;
      return [studentId, Math.round(average * 100) / 100];
    }),
  );
}
