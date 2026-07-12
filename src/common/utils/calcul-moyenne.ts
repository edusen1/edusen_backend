/**
 * Calcul de moyenne selon le système sénégalais
 *
 * Formule : Moyenne matière = (Moyenne devoirs bonifiée + Composition bonifiée) / 2
 *
 * Règles du bonus :
 * 1. Ajouter aux devoirs d'abord (cap 20)
 * 2. Surplus sur la composition (cap 20)
 * 3. Surplus perdu si dépasse 20 partout
 */

export type ModeCalcul = 'MOYENNE' | 'MEILLEURE_NOTE';

export interface ResultatMoyenne {
  moyenneDevoirs: number;
  moyenneDevoirsBonifiee: number;
  noteComposition: number;
  noteCompositionBonifiee: number;
  bonusTotal: number;
  bonusApplique: number;
  bonusPerdu: number;
  moyenneGenerale: number;
  hasNotes: boolean;
}

export function calculerMoyenne(
  devoirs: number[],
  composition: number | null,
  bonus: number,
  modeCalcul: ModeCalcul = 'MOYENNE',
): ResultatMoyenne {
  // Moyenne devoirs selon le mode
  let moyenneDevoirs = 0;
  if (devoirs.length > 0) {
    if (modeCalcul === 'MEILLEURE_NOTE') {
      moyenneDevoirs = Math.max(...devoirs);
    } else {
      moyenneDevoirs = devoirs.reduce((s, v) => s + v, 0) / devoirs.length;
    }
  }

  // Composition (0 si pas saisie)
  const noteComposition = composition ?? 0;

  // Application du bonus
  let bonusRestant = Math.max(0, bonus);
  let moyenneDevoirsBonifiee = moyenneDevoirs;
  let noteCompositionBonifiee = noteComposition;

  // 1. Ajouter aux devoirs (cap 20)
  const espaceDevoirs = Math.max(0, 20 - moyenneDevoirs);
  const bonusSurDevoirs = Math.min(bonusRestant, espaceDevoirs);
  moyenneDevoirsBonifiee = moyenneDevoirs + bonusSurDevoirs;
  bonusRestant -= bonusSurDevoirs;

  // 2. Surplus sur la composition (cap 20)
  const espaceCompo = Math.max(0, 20 - noteComposition);
  const bonusSurCompo = Math.min(bonusRestant, espaceCompo);
  noteCompositionBonifiee = noteComposition + bonusSurCompo;
  bonusRestant -= bonusSurCompo;

  // 3. Surplus perdu
  const bonusApplique = bonus - bonusRestant;
  const bonusPerdu = bonusRestant;

  // Moyenne générale
  const hasNotes = devoirs.length > 0 || composition !== null;
  const moyenneGenerale = hasNotes ? (moyenneDevoirsBonifiee + noteCompositionBonifiee) / 2 : 0;

  return {
    moyenneDevoirs,
    moyenneDevoirsBonifiee,
    noteComposition,
    noteCompositionBonifiee,
    bonusTotal: bonus,
    bonusApplique,
    bonusPerdu,
    moyenneGenerale,
    hasNotes,
  };
}
