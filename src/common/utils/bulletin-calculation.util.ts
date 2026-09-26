export interface BulletinGradeInput {
  eleveId: string;
  matiereId: string;
  note: number;
  noteSur: number;
  typeEvaluation?: string;
}

/**
 * Calcul bulletin système sénégalais :
 * 1. Par matière : moyenne devoirs, note composition
 * 2. Moyenne matière = (moy devoirs + composition) / 2 quand les deux existent,
 *    sinon moyenne des notes disponibles
 * 3. Moy × Coef par matière
 * 4. Moyenne générale = Σ(moy × coef) / Σcoef
 *
 * Règles :
 * - Matière sans aucune note = ignorée pour cet élève
 * - Élève sans notes = 0
 * - Les types DEVOIR, INTERROGATION, CONTROLE, TP, ORAL → catégorie "devoirs"
 * - Les types COMPOSITION, EXAMEN → catégorie "composition"
 * - Les types BONUS → ignorés dans le calcul bulletin (pour l'instant)
 */
export function calculateBulletinAverages(
  studentIds: readonly string[],
  notes: readonly BulletinGradeInput[],
  coefficients: ReadonlyMap<string, number>,
): Map<string, number> {
  const DEVOIR_TYPES = new Set(['DEVOIR', 'INTERROGATION', 'CONTROLE', 'TP', 'ORAL']);
  const COMPO_TYPES = new Set(['COMPOSITION', 'EXAMEN']);

  return new Map(
    studentIds.map((studentId) => {
      const studentNotes = notes.filter((n) => n.eleveId === studentId);
      const matiereIds = [...new Set(studentNotes.map((n) => n.matiereId))];
      let totalPoints = 0;
      let totalCoef = 0;

      for (const matiereId of matiereIds) {
        const matiereNotes = studentNotes.filter((n) => n.matiereId === matiereId);
        const devoirs = matiereNotes.filter((n) => DEVOIR_TYPES.has((n.typeEvaluation ?? 'DEVOIR').toUpperCase()));
        const compositions = matiereNotes.filter((n) => COMPO_TYPES.has((n.typeEvaluation ?? '').toUpperCase()));

        const moyDevoirs = devoirs.length > 0
          ? devoirs.reduce((s, n) => s + (n.noteSur > 0 ? (n.note / n.noteSur) * 20 : n.note), 0) / devoirs.length
          : 0;
        const noteCompo = compositions.length > 0
          ? compositions.reduce((s, n) => s + (n.noteSur > 0 ? (n.note / n.noteSur) * 20 : n.note), 0) / compositions.length
          : 0;

        const moyPeriode = devoirs.length > 0 && compositions.length > 0
          ? (moyDevoirs + noteCompo) / 2
          : devoirs.length > 0
            ? moyDevoirs
            : noteCompo;
        const coef = coefficients.get(matiereId) ?? 1;
        totalPoints += moyPeriode * coef;
        totalCoef += coef;
      }

      const average = totalCoef > 0 ? totalPoints / totalCoef : 0;
      return [studentId, Math.round(average * 100) / 100];
    }),
  );
}
