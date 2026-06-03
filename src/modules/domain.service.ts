import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/config/prisma.service";

@Injectable()
export class DomainService {
  constructor(private readonly prisma: PrismaService) {}

  adminUsers(tenantId: string) {
    return this.prisma.user.findMany({ where: { tenantId } });
  }
  adminTeachers(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId, role: "ENSEIGNANT" },
    });
  }
  adminStudents(tenantId: string) {
    return this.prisma.user.findMany({ where: { tenantId, role: "ELEVE" } });
  }
  adminParents(tenantId: string) {
    return this.prisma.user.findMany({ where: { tenantId, role: "PARENT" } });
  }
  adminMatieres(tenantId: string) {
    return this.prisma.matiere.findMany({ where: { tenantId } });
  }
  adminReclamations(tenantId: string) {
    return this.prisma.reclamation.findMany({ where: { tenantId } });
  }
  adminPaiements(tenantId: string) {
    return this.prisma.paiement.findMany({ where: { tenantId } });
  }
  adminAbsencesEleves(tenantId: string) {
    return this.prisma.absenceEleve.findMany({ where: { tenantId } });
  }
  adminNotes(tenantId: string) {
    return this.prisma.note.findMany({ where: { tenantId } });
  }
  adminBulletins(tenantId: string) {
    return this.prisma.bulletin.findMany({ where: { tenantId } });
  }
  adminEmplois(tenantId: string) {
    return this.prisma.emploiDuTemps.findMany({ where: { tenantId } });
  }

  teacherProfil(userId: string) {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }
  teacherNotes(tenantId: string) {
    return this.prisma.note.findMany({ where: { tenantId } });
  }
  async teacherCreateNote(
    tenantId: string,
    data: {
      eleveId: string;
      matiereId?: string;
      coursId?: string;
      valeur: number;
      typeEval?: string;
    },
  ) {
    let matiereId = data.matiereId;
    if (!matiereId && data.coursId) {
      const cours = await this.prisma.cours.findUnique({
        where: { id: data.coursId },
        select: { matiereId: true },
      });
      matiereId = cours?.matiereId;
    }
    if (!matiereId) {
      throw new BadRequestException("matiereId (ou coursId valide) est requis");
    }
    return this.prisma.note.create({
      data: {
        tenantId,
        eleveId: data.eleveId,
        matiereId,
        typeEvaluation:
          (data.typeEval as
            | "DEVOIR"
            | "INTERROGATION"
            | "EXAMEN"
            | "COMPOSITION"
            | "CONTROLE"
            | "TP"
            | "ORAL") ?? "DEVOIR",
        note: data.valeur,
        trimestre: "TRIMESTRE_1",
        anneeScolaire: new Date().getFullYear().toString(),
      },
    });
  }
  teacherUpdateNote(noteId: string, valeur: number) {
    return this.prisma.note.update({
      where: { id: noteId },
      data: { note: valeur },
    });
  }
  teacherCreateAbsence(
    tenantId: string,
    data: { eleveId: string; classeId: string; motif?: string },
  ) {
    return this.prisma.absenceEleve.create({
      data: { tenantId, ...data, date: new Date() },
    });
  }

  studentProfil(userId: string) {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }
  studentNotes(tenantId: string, eleveId: string) {
    return this.prisma.note.findMany({
      where: { tenantId, eleveId },
      include: { matiere: { select: { id: true, code: true, libelle: true } } },
      orderBy: [
        { anneeScolaire: "desc" },
        { trimestre: "asc" },
        { matiere: { libelle: "asc" } },
        { dateEvaluation: "asc" },
      ],
    });
  }
  studentBulletins(tenantId: string, eleveId: string) {
    return this.prisma.bulletin.findMany({
      where: { tenantId, eleveId },
      include: { classe: { select: { id: true, nom: true } } },
      orderBy: [{ anneeScolaire: "desc" }, { trimestre: "asc" }],
    });
  }
  async studentBulletinExport(tenantId: string, eleveId: string, bulletinId: string) {
    const bulletin = await this.prisma.bulletin.findFirst({
      where: { id: bulletinId, tenantId, eleveId },
      include: { classe: { select: { id: true, nom: true } } },
    });
    if (!bulletin) throw new NotFoundException("Bulletin introuvable");

    const notes = await this.prisma.note.findMany({
      where: { tenantId, eleveId, anneeScolaire: bulletin.anneeScolaire, trimestre: bulletin.trimestre },
      include: { matiere: { select: { code: true, libelle: true } } },
      orderBy: [{ matiere: { libelle: "asc" } }, { dateEvaluation: "asc" }],
    });

    return this.csvExport(`bulletin-${this.safeFilename(bulletin.classe?.nom ?? "classe")}-${bulletin.trimestre}.csv`, [
      ["Classe", bulletin.classe?.nom ?? ""],
      ["Annee scolaire", bulletin.anneeScolaire],
      ["Periode", bulletin.trimestre],
      ["Moyenne", bulletin.moyenne ?? ""],
      ["Rang", bulletin.rang ?? ""],
      [],
      ["Matiere", "Type", "Note", "Bareme", "Date", "Commentaire"],
      ...notes.map((note) => [
        note.matiere?.libelle ?? note.matiere?.code ?? "",
        note.typeEvaluation,
        note.note,
        note.noteSur,
        this.dateOnly(note.dateEvaluation),
        note.commentaire ?? "",
      ]),
    ]);
  }
  async studentEmploiDuTemps(tenantId: string, eleveId: string) {
    const inscription = await this.prisma.inscription.findFirst({
      where: { tenantId, eleveId, statut: "ACTIF" },
      include: {
        anneeAcademique: { select: { libelle: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!inscription) return [];

    const rows = await this.prisma.emploiDuTemps.findMany({
      where: {
        tenantId,
        classeId: inscription.classeId,
        ...(inscription.anneeAcademique?.libelle
          ? { OR: [{ anneeScolaire: null }, { anneeScolaire: inscription.anneeAcademique.libelle }] }
          : {}),
      },
      include: {
        classe: { select: { id: true, nom: true } },
        cours: {
          include: {
            matiere: { select: { id: true, code: true, libelle: true } },
            classe: { select: { id: true, nom: true } },
          },
        },
        salle: { include: { batiment: { select: { id: true, nom: true } } } },
      },
      orderBy: [{ jourSemaine: "asc" }, { heureDebut: "asc" }],
    });

    return this.mapEmploiDuTempsRows(rows);
  }
  studentAbsences(tenantId: string, eleveId: string) {
    return this.prisma.absenceEleve.findMany({ where: { tenantId, eleveId } });
  }
  studentNotifications(tenantId: string, eleveId: string) {
    return this.prisma.notification.findMany({
      where: { tenantId, destinataireId: eleveId },
    });
  }
  studentReadNotification(id: string) {
    return this.prisma.notification.update({
      where: { id },
      data: { lu: true },
    });
  }
  studentReclamations(tenantId: string, eleveId: string) {
    return this.prisma.reclamation.findMany({
      where: { tenantId, eleveId },
      include: { note: { include: { matiere: { select: { id: true, code: true, libelle: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
  }
  async studentReclamationNotes(tenantId: string, eleveId: string) {
    return this.prisma.note.findMany({
      where: { tenantId, eleveId },
      include: { matiere: { select: { id: true, code: true, libelle: true } } },
      orderBy: [
        { anneeScolaire: 'desc' },
        { trimestre: 'asc' },
        { matiere: { libelle: 'asc' } },
        { dateEvaluation: 'asc' },
      ],
    });
  }
  async studentCreateReclamation(
    tenantId: string,
    eleveId: string,
    motif: string,
    noteId?: string,
    pieceJointeUrl?: string,
  ) {
    if (!noteId) throw new BadRequestException('La note concernée est obligatoire');
    const note = await this.prisma.note.findFirst({
      where: { id: noteId, tenantId, eleveId },
      select: { id: true },
    });
    if (!note) throw new BadRequestException('Note concernée introuvable');
    const existing = await this.prisma.reclamation.findFirst({
      where: { tenantId, eleveId, noteId, statut: 'EN_ATTENTE' },
      select: { id: true },
    });
    if (existing) throw new BadRequestException('Une réclamation est déjà en attente pour cette note');
    return this.prisma.reclamation.create({
      data: { tenantId, eleveId, motif, noteId, pieceJointeUrl } as any,
    });
  }

  parentPaiements(tenantId: string) {
    return this.prisma.paiement.findMany({ where: { tenantId } });
  }
  caissePaiements(tenantId: string) {
    return this.prisma.paiement.findMany({ where: { tenantId } });
  }
  caissePaiementById(id: string) {
    return this.prisma.paiement.findUnique({ where: { id } });
  }
  caisseValiderPaiement(id: string) {
    return this.prisma.paiement.update({
      where: { id },
      data: { statut: "VALIDE" },
    });
  }

  v1Paiements(tenantId: string) {
    return this.prisma.paiement.findMany({ where: { tenantId } });
  }
  v1Inscriptions(tenantId: string) {
    return this.prisma.inscription.findMany({ where: { tenantId } });
  }
  v1TransferInscription(id: string, classeId: string) {
    return this.prisma.inscription.update({
      where: { id },
      data: { classeId },
    });
  }
  v1AbsencesEleves(tenantId: string) {
    return this.prisma.absenceEleve.findMany({ where: { tenantId } });
  }
  v1ApprouverAbsence(id: string) {
    return this.prisma.absenceEleve.update({
      where: { id },
      data: { statut: "JUSTIFIEE", justifiee: true },
    });
  }
  v1RejeterAbsence(id: string) {
    return this.prisma.absenceEleve.update({
      where: { id },
      data: { statut: "NON_JUSTIFIEE", justifiee: false },
    });
  }
  v1Emplois(tenantId: string) {
    return this.prisma.emploiDuTemps.findMany({ where: { tenantId } });
  }
  v1Convocations(tenantId: string) {
    return this.prisma.convocation.findMany({ where: { tenantId } });
  }
  v1CompteRenduConvocation(id: string, compteRendu: string) {
    return this.prisma.convocation.update({
      where: { id },
      data: { compteRendu },
    });
  }

  v1Personnel(tenantId: string) {
    return this.prisma.personnel.findMany({ where: { tenantId } });
  }
  v1Pointages(tenantId: string) {
    return this.prisma.pointage.findMany({ where: { tenantId } });
  }
  v1AbsencesPersonnel(tenantId: string) {
    return this.prisma.absencePersonnel.findMany({ where: { tenantId } });
  }
  v1ValiderAbsencePersonnel(id: string) {
    return this.prisma.absencePersonnel.update({
      where: { id },
      data: { statut: "APPROUVEE" },
    });
  }
  v1RefuserAbsencePersonnel(id: string) {
    return this.prisma.absencePersonnel.update({
      where: { id },
      data: { statut: "REJETEE" },
    });
  }

  private async mapEmploiDuTempsRows(rows: any[]) {
    const matiereIds = [...new Set(rows.map((row) => row.matiereId ?? row.cours?.matiereId).filter(Boolean))] as string[];
    const enseignantIds = [...new Set(rows.map((row) => row.enseignantId ?? row.cours?.enseignantId).filter(Boolean))] as string[];

    const [matieres, enseignants] = await Promise.all([
      matiereIds.length
        ? this.prisma.matiere.findMany({
            where: { id: { in: matiereIds } },
            select: { id: true, code: true, libelle: true },
          })
        : [],
      enseignantIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: enseignantIds } },
            select: { id: true, firstName: true, lastName: true },
          })
        : [],
    ]);

    const matiereById = new Map(matieres.map((matiere) => [matiere.id, matiere]));
    const enseignantById = new Map(enseignants.map((enseignant) => [enseignant.id, enseignant]));

    return rows.map((row) => {
      const matiereId = row.matiereId ?? row.cours?.matiereId ?? null;
      const enseignantId = row.enseignantId ?? row.cours?.enseignantId ?? null;
      const matiere = matiereId ? matiereById.get(matiereId) ?? row.cours?.matiere ?? null : null;
      const enseignant = enseignantId ? enseignantById.get(enseignantId) ?? null : null;

      return {
        id: row.id,
        classeId: row.classeId,
        classeNom: row.classe?.nom ?? row.cours?.classe?.nom ?? "",
        coursId: row.coursId,
        matiereId,
        matiereLibelle: matiere?.libelle ?? null,
        matiereCode: matiere?.code ?? null,
        enseignantId,
        enseignantNom: enseignant ? `${enseignant.firstName ?? ""} ${enseignant.lastName ?? ""}`.trim() : null,
        salleId: row.salleId,
        salleNom: row.salle?.nom ?? null,
        salleBatimentNom: row.salle?.batiment?.nom ?? null,
        jourSemaine: row.jourSemaine,
        heureDebut: row.heureDebut,
        heureFin: row.heureFin,
        anneeScolaire: row.anneeScolaire,
        dateDebutValidite: row.dateDebutValidite,
        dateFinValidite: row.dateFinValidite,
        publie: row.publie,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }

  private csvExport(filename: string, rows: unknown[][]) {
    return {
      filename,
      mimeType: "text/csv;charset=utf-8",
      content: rows.map((row) => row.map((value) => this.csvCell(value)).join(";")).join("\n"),
    };
  }

  private csvCell(value: unknown): string {
    if (value === null || value === undefined) return "";
    const text = value instanceof Date ? this.dateOnly(value) : String(value);
    const escaped = text.replace(/"/g, '""');
    return /[;"\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
  }

  private dateOnly(value?: Date | string | null): string {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().substring(0, 10);
  }

  private safeFilename(value: string): string {
    return value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "export";
  }
}
