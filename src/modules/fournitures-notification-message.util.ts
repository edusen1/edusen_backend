export interface FournituresMessageItem {
  nom: string;
  quantite: number;
  obligatoire: boolean;
}

export function buildFournituresWhatsappMessage(input: {
  classeNom: string;
  eleveNom: string;
  anneeLibelle?: string | null;
  destinataire?: string | null;
  obligatoires: FournituresMessageItem[];
  facultatifs: FournituresMessageItem[];
  pdfUrl?: string | null;
}): string {
  const waLines: string[] = [
    `*${input.classeNom} — Liste des fournitures*`,
    '',
    `Bonjour${input.destinataire ? ` ${input.destinataire}` : ''},`,
    '',
    `*${input.eleveNom}* vient d'être inscrit(e) en *${input.classeNom}*${input.anneeLibelle ? ` (année ${input.anneeLibelle})` : ''}.`,
    '',
  ];

  if (input.obligatoires.length > 0) {
    waLines.push('*Fournitures obligatoires :*');
    input.obligatoires.forEach((f) => waLines.push(`  • ${f.nom} — qté : ${f.quantite}`));
  }
  if (input.facultatifs.length > 0) {
    if (input.obligatoires.length > 0) waLines.push('');
    waLines.push('_Facultatifs :_');
    input.facultatifs.forEach((f) => waLines.push(`  • ${f.nom} — qté : ${f.quantite}`));
  }

  waLines.push('');
  if (input.pdfUrl) {
    waLines.push('Fiche PDF :', input.pdfUrl);
  } else {
    waLines.push("_La fiche complète est disponible auprès de l'administration._");
  }
  waLines.push('_Bonne rentrée scolaire !_');
  return waLines.join('\n');
}
