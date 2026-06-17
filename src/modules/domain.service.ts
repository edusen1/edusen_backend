import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "@/config/prisma.service";
import { WhatsappService } from "@/modules/whatsapp/whatsapp.service";
import { normalizePhoneForCountry } from "@/common/utils/phone.util";
import { formatMru } from "@/common/utils/currency.util";

@Injectable()
export class DomainService {
  private readonly userProfileSelect = {
    id: true,
    username: true,
    email: true,
    firstName: true,
    lastName: true,
    telephone: true,
    numeroIdentificationNational: true,
    adresse: true,
    role: true,
    actif: true,
    matricule: true,
    dateNaissance: true,
    lieuNaissance: true,
    genre: true,
    numeroUrgence: true,
    dateInscription: true,
    photoUrl: true,
    classeId: true,
    specialite: true,
    dateEmbauche: true,
    profession: true,
    lieuTravail: true,
    telephoneTravail: true,
    lienParente: true,
  } as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
  ) {}

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
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: this.userProfileSelect,
    });
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
    const note = await this.prisma.note.create({
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

    void this.notifyNoteCreated(tenantId, note.eleveId, note.id).catch(() => {});
    return note;
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
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: this.userProfileSelect,
    });
  }
  async studentUpdateProfil(userId: string, data: { telephone?: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tenantId: true },
    });
    if (!user) throw new NotFoundException("Utilisateur introuvable");

    const config = await this.prisma.ecoleConfig.findUnique({
      where: { tenantId: user.tenantId },
      select: { pays: true },
    });

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        telephone:
          data.telephone !== undefined
            ? normalizePhoneForCountry(data.telephone, config?.pays ?? "SN") ?? null
            : undefined,
      },
      select: this.userProfileSelect,
    });
  }
  studentNotes(tenantId: string, eleveId: string, trimestre?: string) {
    return this.prisma.note.findMany({
      where: { tenantId, eleveId, ...(trimestre ? { trimestre } : {}) },
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
  async studentReadAllNotifications(tenantId: string, destinataireId: string) {
    await this.prisma.notification.updateMany({
      where: { tenantId, destinataireId, lu: false },
      data: { lu: true },
    });
    return { success: true };
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
    const reclamation = await this.prisma.reclamation.create({
      data: { tenantId, eleveId, motif, noteId, pieceJointeUrl } as any,
    });
    void this.notifyReclamationCreated(tenantId, eleveId, noteId, reclamation.id).catch(() => {});
    return reclamation;
  }

  private async notifyNoteCreated(tenantId: string, eleveId: string, noteId: string): Promise<void> {
    const note = await this.prisma.note.findFirst({
      where: { id: noteId, tenantId, eleveId },
      include: { matiere: { select: { libelle: true, code: true } } },
    });
    if (!note) return;

    const eleve = await this.prisma.user.findUnique({
      where: { id: eleveId },
      select: { id: true, firstName: true, lastName: true, telephone: true },
    });
    const parents = await this.prisma.eleveParent.findMany({
      where: { eleveId },
      include: { parent: { select: { id: true, firstName: true, lastName: true, telephone: true } } },
    });

    const message = [
      'NouraSchool - Nouvelle note',
      `Matière: ${note.matiere?.libelle ?? note.matiere?.code ?? '—'}`,
      `Note: ${note.note ?? '—'}/${note.noteSur ?? 20}`,
      `Période: ${note.trimestre ?? '—'}`,
      'Vous pouvez consulter les détails et déposer une réclamation si nécessaire.',
    ].join('\n');

    const notifications: Array<{ destinataireId: string; titre: string; contenu: string }> = [];
    if (eleve) {
      notifications.push({
        destinataireId: eleve.id,
        titre: 'Nouvelle note publiée',
        contenu: message,
      });
      if (eleve.telephone) {
        this.whatsapp.sendMessage(tenantId, eleve.telephone, message).catch(() => {});
      }
    }
    for (const link of parents) {
      notifications.push({
        destinataireId: link.parent.id,
        titre: 'Nouvelle note de votre enfant',
        contenu: message,
      });
      if (link.parent.telephone) {
        this.whatsapp.sendMessage(tenantId, link.parent.telephone, message).catch(() => {});
      }
    }
    if (notifications.length) {
      await this.prisma.notification.createMany({
        data: notifications.map((n) => ({
          tenantId,
          destinataireId: n.destinataireId,
          titre: n.titre,
          contenu: n.contenu,
          lu: false,
        })),
      });
    }
    this.whatsapp.broadcastToRoles(tenantId, message, ['ADMIN']).catch(() => {});
  }

  private async notifyReclamationCreated(tenantId: string, eleveId: string, noteId: string, reclamationId: string): Promise<void> {
    const [note, reclamation] = await Promise.all([
      this.prisma.note.findFirst({
        where: { id: noteId, tenantId, eleveId },
        include: { matiere: { select: { libelle: true, code: true } } },
      }),
      this.prisma.reclamation.findFirst({
        where: { id: reclamationId, tenantId, eleveId },
        select: { motif: true },
      }),
    ]);
    const eleve = await this.prisma.user.findUnique({
      where: { id: eleveId },
      select: { id: true, firstName: true, lastName: true, telephone: true },
    });
    if (!note || !eleve) return;
    const motif = String(reclamation?.motif ?? '').trim();
    const motifResume = motif.length > 120 ? `${motif.slice(0, 117)}...` : motif;
    const message = [
      'NouraSchool - Réclamation déposée',
      `Élève: ${eleve.firstName ?? ''} ${eleve.lastName ?? ''}`.trim(),
      `Matière: ${note.matiere?.libelle ?? note.matiere?.code ?? '—'}`,
      `Motif: ${motifResume || 'Réclamation liée à une note'}`,
      'Ouvrez la plateforme pour la traiter.',
    ].join('\n');
    this.whatsapp.broadcastToRoles(tenantId, message, ['ADMIN', 'ENSEIGNANT']).catch(() => {});
    if (eleve.telephone) {
      this.whatsapp.sendMessage(tenantId, eleve.telephone, message).catch(() => {});
    }
  }

  async assertParentChild(parentId: string, eleveId: string): Promise<void> {
    const link = await this.prisma.eleveParent.findUnique({
      where: { eleveId_parentId: { eleveId, parentId } },
      select: { eleveId: true },
    });
    if (!link) {
      throw new NotFoundException("Élève introuvable");
    }
  }

  async parentPaiements(tenantId: string, parentId: string) {
    const links = await this.prisma.eleveParent.findMany({
      where: { parentId },
      select: { eleveId: true },
    });
    const eleveIds = links.map((link) => link.eleveId);
    const rows = await this.prisma.paiement.findMany({
      where: {
        tenantId,
        OR: [
          { parentId },
          ...(eleveIds.length ? [{ eleveId: { in: eleveIds } }] : []),
        ],
      },
      include: this.paiementInclude,
      orderBy: { createdAt: "desc" },
    });
    return this.attachEleveToPaiements(rows);
  }
  // ─── CAISSE ────────────────────────────────────────────────────────────────

  private readonly paiementInclude = {
    inscription: {
      include: {
        classe: { select: { id: true, nom: true } },
        anneeAcademique: { select: { id: true, libelle: true } },
      },
    },
  } as const;

  private async attachEleveToPaiements<T extends { eleveId?: string | null; eleve?: unknown }>(
    rows: T[],
  ): Promise<T[]> {
    const ids = [...new Set(rows.map((r) => r.eleveId).filter(Boolean))] as string[];
    if (!ids.length) return rows;
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        matricule: true,
        telephone: true,
        elevParents: {
          select: {
            parent: {
              select: { id: true, firstName: true, lastName: true, telephone: true, lienParente: true },
            },
          },
        },
      },
    });
    const map = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({ ...r, eleve: map.get(r.eleveId ?? '') ?? null }));
  }

  async caisseDashboard(tenantId: string) {
    const now = new Date();
    const startDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const [todayCnt, todayAgg, monthCnt, monthAgg, enAttenteCnt, enAttenteAgg, rejeteCnt, totalCnt] =
      await Promise.all([
        this.prisma.paiement.count({ where: { tenantId, statut: 'VALIDE', datePaiement: { gte: startDay } } }),
        this.prisma.paiement.aggregate({ where: { tenantId, statut: 'VALIDE', datePaiement: { gte: startDay } }, _sum: { montant: true } }),
        this.prisma.paiement.count({ where: { tenantId, statut: 'VALIDE', datePaiement: { gte: startMonth } } }),
        this.prisma.paiement.aggregate({ where: { tenantId, statut: 'VALIDE', datePaiement: { gte: startMonth } }, _sum: { montant: true } }),
        this.prisma.paiement.count({ where: { tenantId, statut: 'EN_ATTENTE' } }),
        this.prisma.paiement.aggregate({ where: { tenantId, statut: 'EN_ATTENTE' }, _sum: { montant: true } }),
        this.prisma.paiement.count({ where: { tenantId, statut: 'REJETE' } }),
        this.prisma.paiement.count({ where: { tenantId } }),
      ]);
    const recentRows = await this.prisma.paiement.findMany({
      where: { tenantId },
      select: {
        id: true,
        reference: true,
        montant: true,
        statut: true,
        typePaiement: true,
        datePaiement: true,
        createdAt: true,
        eleveId: true,
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 6,
    });
    const derniersPaiements = await this.attachEleveToPaiements(recentRows as any);

    return {
      today: { count: todayCnt, montant: todayAgg._sum.montant ?? 0 },
      month: { count: monthCnt, montant: monthAgg._sum.montant ?? 0 },
      enAttente: { count: enAttenteCnt, montant: enAttenteAgg._sum.montant ?? 0 },
      rejete: { count: rejeteCnt },
      total: totalCnt,
      derniersPaiements,
    };
  }

  async caissePaiements(
    tenantId: string,
    filters: {
      statut?: string;
      typePaiement?: string;
      eleveId?: string;
      dateFrom?: string;
      dateTo?: string;
      search?: string;
      page?: number;
      size?: number;
    } = {},
  ) {
    const where: Record<string, unknown> = { tenantId };
    if (filters.statut) where.statut = filters.statut;
    if (filters.typePaiement) where.typePaiement = filters.typePaiement;
    if (filters.eleveId) where.eleveId = filters.eleveId;
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {
        ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
        ...(filters.dateTo ? { lte: new Date(filters.dateTo + 'T23:59:59') } : {}),
      };
    }

    const page = filters.page ?? 0;
    const size = filters.size ?? 50;

    let rows = await this.prisma.paiement.findMany({
      where,
      include: this.paiementInclude,
      orderBy: { createdAt: 'desc' },
      skip: page * size,
      take: size,
    });
    rows = await this.attachEleveToPaiements(rows as any) as any;

    if (filters.search) {
      const q = filters.search.toLowerCase();
      rows = rows.filter((r: any) => {
        const eleve = r.eleve ?? r.inscription?.eleve;
        const nom = `${eleve?.firstName ?? ''} ${eleve?.lastName ?? ''}`.toLowerCase();
        return nom.includes(q) || (r.reference ?? '').toLowerCase().includes(q) || (eleve?.matricule ?? '').toLowerCase().includes(q);
      });
    }

    const total = await this.prisma.paiement.count({ where });
    return { content: rows, total, page, size };
  }

  async caissePaiementById(id: string) {
    const row = await this.prisma.paiement.findUnique({ where: { id }, include: this.paiementInclude });
    if (!row) throw new NotFoundException('Paiement introuvable');
    const [hydrated] = await this.attachEleveToPaiements([row as any]);
    return hydrated;
  }

  async caisseCreatePaiement(
    tenantId: string,
    body: {
      eleveId: string;
      inscriptionId?: string;
      montant: number;
      typePaiement: string;
      modePaiement: string;
      anneeScolaire: string;
      trimestre?: string;
      description?: string;
      transactionId?: string;
      statut?: string;
    },
    userId?: string,
  ) {
    const year = new Date().getFullYear();
    const ref = `PAY-${year}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const created = await this.prisma.paiement.create({
      data: {
        tenantId,
        eleveId: body.eleveId,
        inscriptionId: body.inscriptionId ?? null,
        reference: ref,
        montant: Number(body.montant),
        typePaiement: body.typePaiement as any,
        modePaiement: body.modePaiement as any,
        statut: (body.statut ?? 'EN_ATTENTE') as any,
        anneeScolaire: body.anneeScolaire,
        trimestre: body.trimestre ?? null,
        description: body.description ?? null,
        transactionId: body.transactionId ?? null,
        datePaiement: body.statut === 'VALIDE' ? new Date() : null,
        validePar: body.statut === 'VALIDE' ? (userId ?? null) : null,
      },
      include: this.paiementInclude,
    });
    return created;
  }

  async caisseValiderPaiement(id: string, userId?: string) {
    const paiement = await this.prisma.paiement.findUnique({ where: { id } });
    if (!paiement) throw new NotFoundException('Paiement introuvable');
    const updated = await this.prisma.paiement.update({
      where: { id },
      data: { statut: 'VALIDE', datePaiement: new Date(), validePar: userId ?? null },
      include: this.paiementInclude,
    });
    // Notify via WhatsApp
    const eleve = await this.prisma.user.findUnique({
      where: { id: paiement.eleveId },
      select: { firstName: true, lastName: true, telephone: true },
    });
    if (eleve?.telephone) {
      const msg = `✅ *Paiement confirmé*\nBonjour ${eleve.firstName ?? ''},\nVotre paiement de *${formatMru(paiement.montant)}* (${paiement.typePaiement}) a été validé.\nRéférence : ${paiement.reference}`;
      this.whatsapp.sendMessage(paiement.tenantId, eleve.telephone, msg).catch(() => {});
    }
    return updated;
  }

  async caisseRejeterPaiement(id: string, motif?: string) {
    const paiement = await this.prisma.paiement.findUnique({ where: { id } });
    if (!paiement) throw new NotFoundException('Paiement introuvable');
    return this.prisma.paiement.update({
      where: { id },
      data: {
        statut: 'REJETE',
        description: motif ? `[REJETÉ] ${motif}` : paiement.description,
      },
    });
  }

  async caisseEleves(tenantId: string, search?: string) {
    const where: Record<string, unknown> = { tenantId, role: 'ELEVE', actif: true };
    const users = await this.prisma.user.findMany({
      where,
      select: { id: true, firstName: true, lastName: true, matricule: true, telephone: true, classeId: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 200,
    });
    let result = users;
    if (search) {
      const q = search.toLowerCase();
      result = users.filter((u) => {
        const nom = `${u.firstName ?? ''} ${u.lastName ?? ''}`.toLowerCase();
        return nom.includes(q) || (u.matricule ?? '').toLowerCase().includes(q);
      });
    }
    // Attach classe
    const classeIds = [...new Set(result.map((u) => u.classeId).filter(Boolean))] as string[];
    const classes = classeIds.length
      ? await this.prisma.classe.findMany({ where: { id: { in: classeIds } }, select: { id: true, nom: true } })
      : [];
    const classeMap = new Map(classes.map((c) => [c.id, c]));
    return result.map((u) => ({ ...u, classe: u.classeId ? (classeMap.get(u.classeId) ?? null) : null }));
  }

  async caisseHistorique(tenantId: string, dateFrom?: string, dateTo?: string) {
    const where: Record<string, unknown> = { tenantId, statut: 'VALIDE' };
    if (dateFrom || dateTo) {
      where.datePaiement = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo + 'T23:59:59') } : {}),
      };
    }
    const rows = await this.prisma.paiement.findMany({
      where,
      include: this.paiementInclude,
      orderBy: { datePaiement: 'desc' },
    });
    return this.attachEleveToPaiements(rows as any);
  }

  v1Paiements(tenantId: string) {
    return this.prisma.paiement.findMany({
      where: { tenantId },
      include: {
        inscription: {
          include: {
            classe: { select: { id: true, nom: true } },
            anneeAcademique: { select: { id: true, libelle: true } },
          },
        },
      },
    });
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
