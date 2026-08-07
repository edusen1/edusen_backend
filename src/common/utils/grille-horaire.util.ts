/**
 * Grille horaire d'une école.
 *
 * Au préscolaire et au primaire, la journée suit une trame fixe : une matinée
 * coupée par une récréation, puis une après-midi les jours pleins. L'emploi du
 * temps n'a donc pas à être saisi créneau par créneau — la trame est connue, et
 * seule la matière change d'une case à l'autre.
 *
 * La grille est stockée par école (`EcoleConfig.grilleHoraire`) : les horaires
 * varient d'un établissement à l'autre, et une même école peut décider de
 * finir à 13 h plutôt qu'à 12 h.
 */

export type TypeCreneau = 'COURS' | 'RECREATION';

export interface CreneauGenere {
  type: TypeCreneau;
  heureDebut: string;
  heureFin: string;
  /** Libellé prêt à afficher : « 8h–10h », « Récréation ». */
  libelle: string;
}

export interface GrilleCycle {
  /** Jours comportant matin **et** après-midi. */
  joursAvecApresMidi: string[];
  /** Jours limités à la matinée (mercredi, le plus souvent). */
  joursMatinSeul: string[];
  matinDebut: string;
  matinFin: string;
  apresMidiDebut: string;
  apresMidiFin: string;
  recreationDebut: string;
  recreationMinutes: number;
}

export type GrilleHoraire = Record<string, GrilleCycle>;

/** Cycles dont l'emploi du temps suit une trame fixe. */
export const CYCLES_TRAME_FIXE = ['PRESCOLAIRE', 'MATERNELLE', 'CRECHE', 'PRIMAIRE', 'ELEMENTAIRE'];

/**
 * Grille par défaut, appliquée tant qu'une école n'a rien paramétré.
 * Reprend l'organisation la plus répandue : lundi, mardi, jeudi et vendredi en
 * journée complète, mercredi en matinée seule.
 */
export const GRILLE_PAR_DEFAUT: GrilleCycle = {
  joursAvecApresMidi: ['Lundi', 'Mardi', 'Jeudi', 'Vendredi'],
  joursMatinSeul: ['Mercredi'],
  matinDebut: '08:00',
  matinFin: '12:00',
  apresMidiDebut: '15:00',
  apresMidiFin: '17:00',
  recreationDebut: '10:00',
  recreationMinutes: 30,
};

/**
 * Lit une colonne JSON comme un objet exploitable.
 *
 * Prisma type ces colonnes `JsonValue` : la valeur peut être un tableau, un
 * nombre ou une chaîne, formes qu'un transtypage direct vers un `Record`
 * accepterait sans broncher au prix d'une erreur de compilation — et, si le
 * transtypage passait, d'un plantage à l'exécution sur une donnée mal formée.
 * On vérifie donc la forme avant d'exploiter la valeur.
 */
export function objetJson<T extends object>(valeur: unknown): Partial<T> {
  if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) return {};
  return valeur as Partial<T>;
}

function versMinutes(heure: string): number {
  const [h, m] = String(heure).split(':').map((v) => Number(v) || 0);
  return h * 60 + m;
}

function versHeure(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** « 08:00 » → « 8h », « 10:30 » → « 10h30 ». */
export function libelleHeure(heure: string): string {
  const [h, m] = String(heure).split(':');
  const heures = String(Number(h));
  return Number(m) === 0 ? `${heures}h` : `${heures}h${m}`;
}

export function grilleDuCycle(grille: GrilleHoraire | null | undefined, cycleCode: string): GrilleCycle {
  return grille?.[cycleCode] ?? GRILLE_PAR_DEFAUT;
}

/**
 * Créneaux d'une journée pour un cycle donné.
 *
 * La récréation coupe la matinée en deux : elle n'est pas un créneau ajouté à
 * la suite, elle scinde la plage. Une récréation posée hors de la matinée est
 * ignorée plutôt que de produire des créneaux qui se chevauchent.
 */
export function genererCreneaux(grille: GrilleCycle, jour: string): CreneauGenere[] {
  const aApresMidi = grille.joursAvecApresMidi.includes(jour);
  const aMatinSeul = grille.joursMatinSeul.includes(jour);
  if (!aApresMidi && !aMatinSeul) return [];

  const creneaux: CreneauGenere[] = [];
  const debutMatin = versMinutes(grille.matinDebut);
  const finMatin = versMinutes(grille.matinFin);
  const debutRecre = versMinutes(grille.recreationDebut);
  const finRecre = debutRecre + (Number(grille.recreationMinutes) || 0);

  const cours = (debut: number, fin: number) => {
    if (fin <= debut) return;
    creneaux.push({
      type: 'COURS',
      heureDebut: versHeure(debut),
      heureFin: versHeure(fin),
      libelle: `${libelleHeure(versHeure(debut))}–${libelleHeure(versHeure(fin))}`,
    });
  };

  const recreDansMatinee = debutRecre > debutMatin && finRecre < finMatin;
  if (recreDansMatinee) {
    cours(debutMatin, debutRecre);
    creneaux.push({
      type: 'RECREATION',
      heureDebut: versHeure(debutRecre),
      heureFin: versHeure(finRecre),
      libelle: 'Récréation',
    });
    cours(finRecre, finMatin);
  } else {
    cours(debutMatin, finMatin);
  }

  if (aApresMidi) {
    cours(versMinutes(grille.apresMidiDebut), versMinutes(grille.apresMidiFin));
  }

  return creneaux;
}

/** Heure de fin de journée, pour afficher « Descente ». */
export function heureDescente(grille: GrilleCycle, jour: string): string | null {
  if (grille.joursAvecApresMidi.includes(jour)) return grille.apresMidiFin;
  if (grille.joursMatinSeul.includes(jour)) return grille.matinFin;
  return null;
}
