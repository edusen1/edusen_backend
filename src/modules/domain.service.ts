import { BadRequestException, Injectable } from "@nestjs/common";
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
    return this.prisma.note.findMany({ where: { tenantId, eleveId } });
  }
  studentBulletins(tenantId: string, eleveId: string) {
    return this.prisma.bulletin.findMany({ where: { tenantId, eleveId } });
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
    return this.prisma.reclamation.findMany({ where: { tenantId, eleveId } });
  }
  studentCreateReclamation(
    tenantId: string,
    eleveId: string,
    motif: string,
    noteId?: string,
  ) {
    return this.prisma.reclamation.create({
      data: { tenantId, eleveId, motif, noteId },
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
}
