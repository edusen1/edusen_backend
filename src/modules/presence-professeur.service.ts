import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StatutPresence } from '@prisma/client';
import { PrismaService } from '@/config/prisma.service';
import type { JwtUser } from '@/common/types/auth.types';
import { PushNotificationService } from '@/modules/push-notification.service';
import { CycleScopeService } from '@/modules/cycle-scope.service';

type PresencePayload = {
  emploiDuTempsId?: string;
  statut?: StatutPresence;
  observations?: string | null;
};

type PaiementProfesseurPayload = {
  enseignantId?: string;
  dateDebut?: string;
  dateFin?: string;
  montant?: unknown;
  observations?: string | null;
};

const DAY_CODES = ['DIMANCHE', 'LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI'];

/**
 * `EmploiDuTemps.jourSemaine` est une chaîne libre (`VarChar(20)`), pas un enum :
 * la base contient « Jeudi » alors que `DAY_CODES` produit « JEUDI ». Postgres
 * compare les chaînes en respectant la casse, donc le filtre ne remontait
 * jamais rien et le pointage des enseignants restait vide malgré 67 créneaux.
 * On interroge donc sur toutes les casses rencontrées.
 */
function jourVariants(code: string): string[] {
  const lower = code.toLowerCase();
  const capitalized = lower.charAt(0).toUpperCase() + lower.slice(1);
  return [...new Set([code, lower, capitalized])];
}

@Injectable()
export class PresenceProfesseurService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pushNotifications: PushNotificationService,
    private readonly cycleScope: CycleScopeService,
  ) {}

  async coursDuJour(tenantId: string, dateIso: string, user?: JwtUser): Promise<unknown[]> {
    const date = this.parseDate(dateIso);
    const jourSemaine = DAY_CODES[date.getUTCDay()];
    const cycleIds = await this.visibleCycleIds(tenantId, user);

    const slots = await this.prisma.emploiDuTemps.findMany({
      where: {
        tenantId,
        jourSemaine: { in: jourVariants(jourSemaine) },
        coursId: { not: null },
        ...(cycleIds ? { classe: { niveau: { cycleId: { in: cycleIds } } } } : {}),
        OR: [
          { dateDebutValidite: null },
          { dateDebutValidite: { lte: date } },
        ],
        AND: [
          {
            OR: [
              { dateFinValidite: null },
              { dateFinValidite: { gte: date } },
            ],
          },
        ],
      },
      include: {
        classe: { select: { id: true, nom: true } },
        cours: {
          include: {
            matiere: { select: { id: true, libelle: true, code: true } },
          },
        },
      },
      orderBy: [{ heureDebut: 'asc' }, { classeId: 'asc' }],
    });

    const emploiIds = slots.map((slot) => slot.id);
    const presences = emploiIds.length
      ? await this.prisma.presenceCoursProfesseur.findMany({
          where: { tenantId, dateCours: date, emploiDuTempsId: { in: emploiIds } },
        })
      : [];
    const presenceBySlot = new Map(presences.map((presence) => [presence.emploiDuTempsId, presence]));
    const teacherIds = [...new Set(slots.map((slot) => slot.cours?.enseignantId).filter(Boolean))] as string[];
    const teachers = teacherIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: teacherIds }, tenantId },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const teacherById = new Map(teachers.map((teacher) => [teacher.id, teacher]));

    return slots
      .filter((slot) => slot.cours?.enseignantId)
      .map((slot) => {
        const cours = slot.cours!;
        const teacher = teacherById.get(cours.enseignantId);
        const presence = presenceBySlot.get(slot.id) ?? null;
        const minutesPlanifiees = this.minutesBetween(slot.heureDebut, slot.heureFin);
        const montantHoraire = Number(cours.montantHoraire ?? 0);
        const salairePlanifie = this.roundMoney((minutesPlanifiees / 60) * montantHoraire);

        return {
          id: slot.id,
          emploiDuTempsId: slot.id,
          coursId: cours.id,
          dateCours: dateIso,
          classe: slot.classe,
          matiere: cours.matiere,
          enseignant: teacher
            ? { id: teacher.id, firstName: teacher.firstName, lastName: teacher.lastName, email: teacher.email }
            : { id: cours.enseignantId },
          heureDebut: slot.heureDebut,
          heureFin: slot.heureFin,
          minutesPlanifiees,
          heuresPlanifiees: minutesPlanifiees / 60,
          montantHoraire,
          salairePlanifie,
          presence: presence ? this.toPresenceResponse(presence) : null,
        };
      });
  }

  async enregistrerPresence(tenantId: string, dateIso: string, payload: PresencePayload, user?: JwtUser): Promise<unknown> {
    const date = this.parseDate(dateIso);
    const emploiDuTempsId = String(payload.emploiDuTempsId ?? '').trim();
    if (!emploiDuTempsId) throw new BadRequestException('emploiDuTempsId est requis');
    const statut = this.normalizeStatut(payload.statut);

    const slot = await this.prisma.emploiDuTemps.findFirst({
      where: { id: emploiDuTempsId, tenantId, coursId: { not: null } },
      include: {
        classe: { select: { id: true, nom: true } },
        cours: {
          include: {
            matiere: { select: { id: true, libelle: true, code: true } },
          },
        },
      },
    });
    if (!slot?.cours) throw new NotFoundException('Cours du jour introuvable');
    await this.assertCanControlSlot(tenantId, slot.classeId, user);

    const minutesPlanifiees = this.minutesBetween(slot.heureDebut, slot.heureFin);
    const minutesComptabilisees = this.minutesForStatus(minutesPlanifiees, statut);
    const montantHoraire = Number(slot.cours.montantHoraire ?? 0);
    const salaireCalcule = this.roundMoney((minutesComptabilisees / 60) * montantHoraire);

    const presence = await this.prisma.presenceCoursProfesseur.upsert({
      where: {
        tenantId_emploiDuTempsId_dateCours: {
          tenantId,
          emploiDuTempsId,
          dateCours: date,
        },
      },
      create: {
        tenantId,
        coursId: slot.cours.id,
        emploiDuTempsId,
        classeId: slot.classeId,
        enseignantId: slot.cours.enseignantId,
        dateCours: date,
        heureDebut: slot.heureDebut,
        heureFin: slot.heureFin,
        statut,
        minutesPlanifiees,
        minutesComptabilisees,
        montantHoraire,
        salaireCalcule,
        controlePar: user?.sub ?? slot.cours.enseignantId,
        observations: this.cleanObservation(payload.observations),
      },
      update: {
        statut,
        minutesPlanifiees,
        minutesComptabilisees,
        montantHoraire,
        salaireCalcule,
        controlePar: user?.sub ?? slot.cours.enseignantId,
        observations: this.cleanObservation(payload.observations),
      },
    });

    return this.toPresenceResponse(presence);
  }

  async salairesProfesseurs(tenantId: string, dateDebutIso: string, dateFinIso: string, user?: JwtUser): Promise<unknown[]> {
    return this.buildSalarySummaries(tenantId, dateDebutIso, dateFinIso);
  }

  async paiementsProfesseurs(tenantId: string): Promise<unknown[]> {
    const rows = await this.prisma.paiementProfesseur.findMany({
      where: { tenantId },
      select: {
        id: true,
        reference: true,
        dateDebut: true,
        dateFin: true,
        heuresEffectuees: true,
        heuresDeduites: true,
        montant: true,
        statut: true,
        observations: true,
        createdAt: true,
        enseignant: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      enseignant: row.enseignant,
      dateDebut: row.dateDebut,
      dateFin: row.dateFin,
      heuresEffectuees: row.heuresEffectuees,
      heuresDeduites: row.heuresDeduites,
      montant: row.montant,
      statut: row.statut,
      motifRejet: null,
      reponduLe: null,
      observations: row.observations,
      createdAt: row.createdAt,
    }));
  }

  async initialiserPaiementProfesseur(tenantId: string, payload: PaiementProfesseurPayload, user?: JwtUser): Promise<unknown> {
    const enseignantId = String(payload.enseignantId ?? '').trim();
    if (!enseignantId) throw new BadRequestException('enseignantId est requis');
    const dateDebutIso = String(payload.dateDebut ?? '').trim();
    const dateFinIso = String(payload.dateFin ?? '').trim();
    const dateDebut = this.parseDate(dateDebutIso);
    const dateFin = this.parseDate(dateFinIso);
    const summaries = await this.buildSalarySummaries(tenantId, dateDebutIso, dateFinIso) as Array<any>;
    const summary = summaries.find((row) => row?.enseignant?.id === enseignantId);
    if (!summary) throw new BadRequestException('Aucun salaire calculé pour ce professeur sur cette période');
    if (Number(summary.salaireCalcule ?? 0) <= 0) {
      throw new BadRequestException('Le salaire calculé doit être supérieur à 0');
    }
    const requestedAmount = payload.montant === undefined || payload.montant === null || payload.montant === ''
      ? Number(summary.salaireCalcule)
      : Number(payload.montant);
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      throw new BadRequestException('Le montant du paiement doit être supérieur à 0');
    }
    const montant = this.roundMoney(requestedAmount);

    const existing = await this.prisma.paiementProfesseur.findFirst({
      where: { tenantId, enseignantId, dateDebut, dateFin, statut: 'EN_ATTENTE' },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException('Un paiement professeur est déjà en attente pour cette période');
    }

    const reference = `PAY-PROF-${Date.now().toString(36).toUpperCase()}`;
    const title = 'Paiement professeur initialisé';
    const content = `Un paiement de ${montant.toLocaleString('fr-FR')} MRU a été initialisé pour la période du ${dateDebutIso} au ${dateFinIso}. Souhaitez-vous valider ou rejeter ce paiement ?`;
    const created = await this.prisma.$transaction(async (tx) => {
      const notification = await tx.notification.create({
        data: {
          tenantId,
          destinataireId: enseignantId,
          titre: title,
          contenu: content,
        },
      });
      return tx.paiementProfesseur.create({
        data: {
          tenantId,
          enseignantId,
          dateDebut,
          dateFin,
          heuresEffectuees: Number(summary.heuresEffectuees ?? 0),
          heuresDeduites: Number(summary.heuresDeduites ?? 0),
          montant,
          reference,
          initialisePar: user?.sub,
          notificationId: notification.id,
          observations: this.cleanObservation(payload.observations),
        },
        select: {
          id: true,
          reference: true,
          dateDebut: true,
          dateFin: true,
          heuresEffectuees: true,
          heuresDeduites: true,
          montant: true,
          statut: true,
          notificationId: true,
          createdAt: true,
          enseignant: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      });
    });
    await this.pushNotifications.sendToUser(tenantId, enseignantId, { title, body: content });

    return {
      id: created.id,
      reference: created.reference,
      enseignant: created.enseignant,
      dateDebut: created.dateDebut,
      dateFin: created.dateFin,
      heuresEffectuees: created.heuresEffectuees,
      heuresDeduites: created.heuresDeduites,
      montant: created.montant,
      statut: created.statut,
      notificationId: created.notificationId,
      motifRejet: null,
      reponduLe: null,
      createdAt: created.createdAt,
    };
  }

  async paiementsProfesseurPourEnseignant(tenantId: string, enseignantId: string): Promise<unknown[]> {
    const rows = await this.prisma.paiementProfesseur.findMany({
      where: { tenantId, enseignantId },
      select: this.paiementProfesseurBaseSelect(),
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return rows.map((row) => this.toPaiementResponse(row));
  }

  async validerPaiementProfesseur(tenantId: string, paiementId: string, enseignantId: string): Promise<unknown> {
    const paiement = await this.findTeacherPendingPayment(tenantId, paiementId, enseignantId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.paiementProfesseur.update({
        where: { id: paiement.id },
        data: {
          statut: 'VALIDE',
        },
        select: this.paiementProfesseurBaseSelect(),
      });

      if (paiement.initialisePar) {
        await tx.notification.create({
          data: {
            tenantId,
            destinataireId: paiement.initialisePar,
            titre: 'Paiement professeur validé',
            contenu: `Le paiement ${paiement.reference} de ${this.roundMoney(paiement.montant).toLocaleString('fr-FR')} MRU a été validé par le professeur.`,
          },
        });
      }

      return row;
    });
    if (paiement.initialisePar) {
      await this.pushNotifications.sendToUser(tenantId, paiement.initialisePar, {
        title: 'Paiement professeur validé',
        body: `Le paiement ${paiement.reference} de ${this.roundMoney(paiement.montant).toLocaleString('fr-FR')} MRU a été validé par le professeur.`,
      });
    }

    return this.toPaiementResponse(updated);
  }

  async rejeterPaiementProfesseur(tenantId: string, paiementId: string, enseignantId: string, motif: unknown): Promise<unknown> {
    const motifRejet = this.cleanRequiredText(motif, 'Le motif de rejet est obligatoire');
    const paiement = await this.findTeacherPendingPayment(tenantId, paiementId, enseignantId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.paiementProfesseur.update({
        where: { id: paiement.id },
        data: {
          statut: 'REJETE',
        },
        select: this.paiementProfesseurBaseSelect(),
      });

      if (paiement.initialisePar) {
        await tx.notification.create({
          data: {
            tenantId,
            destinataireId: paiement.initialisePar,
            titre: 'Paiement professeur rejeté',
            contenu: `Le paiement ${paiement.reference} de ${this.roundMoney(paiement.montant).toLocaleString('fr-FR')} MRU a été rejeté. Motif : ${motifRejet}`,
          },
        });
      }

      return row;
    });
    if (paiement.initialisePar) {
      await this.pushNotifications.sendToUser(tenantId, paiement.initialisePar, {
        title: 'Paiement professeur rejeté',
        body: `Le paiement ${paiement.reference} de ${this.roundMoney(paiement.montant).toLocaleString('fr-FR')} MRU a été rejeté. Motif : ${motifRejet}`,
      });
    }

    return this.toPaiementResponse(updated);
  }

  private async buildSalarySummaries(tenantId: string, dateDebutIso: string, dateFinIso: string): Promise<unknown[]> {
    const dateDebut = this.parseDate(dateDebutIso);
    const dateFin = this.parseDate(dateFinIso);
    if (dateFin.getTime() < dateDebut.getTime()) {
      throw new BadRequestException('La date de fin doit être après la date de début');
    }

    const rows = await this.prisma.presenceCoursProfesseur.findMany({
      where: {
        tenantId,
        dateCours: { gte: dateDebut, lte: dateFin },
      },
      include: {
        enseignant: { select: { id: true, firstName: true, lastName: true, email: true } },
        cours: { include: { matiere: { select: { id: true, libelle: true, code: true } } } },
      },
      orderBy: [{ enseignantId: 'asc' }, { dateCours: 'asc' }, { heureDebut: 'asc' }],
    });

    const byTeacher = new Map<string, {
      enseignant: unknown;
      heuresPlanifiees: number;
      heuresEffectuees: number;
      heuresDeduites: number;
      salaireCalcule: number;
      presents: number;
      absents: number;
      retards: number;
      lignes: unknown[];
    }>();

    for (const row of rows) {
      const entry = byTeacher.get(row.enseignantId) ?? {
        enseignant: {
          id: row.enseignant.id,
          firstName: row.enseignant.firstName,
          lastName: row.enseignant.lastName,
          email: row.enseignant.email,
        },
        heuresPlanifiees: 0,
        heuresEffectuees: 0,
        heuresDeduites: 0,
        salaireCalcule: 0,
        presents: 0,
        absents: 0,
        retards: 0,
        lignes: [],
      };
      const planned = row.minutesPlanifiees / 60;
      const done = row.minutesComptabilisees / 60;
      entry.heuresPlanifiees += planned;
      entry.heuresEffectuees += done;
      entry.heuresDeduites += Math.max(planned - done, 0);
      entry.salaireCalcule += row.salaireCalcule;
      if (row.statut === 'PRESENT') entry.presents += 1;
      if (row.statut === 'ABSENT') entry.absents += 1;
      if (row.statut === 'RETARD') entry.retards += 1;
      entry.lignes.push({
        id: row.id,
        dateCours: row.dateCours,
        matiere: row.cours.matiere,
        statut: row.statut,
        heuresPlanifiees: planned,
        heuresEffectuees: done,
        montantHoraire: row.montantHoraire,
        salaireCalcule: row.salaireCalcule,
      });
      byTeacher.set(row.enseignantId, entry);
    }

    return [...byTeacher.values()].map((entry) => {
      const heuresEffectuees = this.roundHours(entry.heuresEffectuees);
      const salaireCalcule = this.roundMoney(entry.salaireCalcule);
      return {
        ...entry,
        heuresPlanifiees: this.roundHours(entry.heuresPlanifiees),
        heuresEffectuees,
        heuresDeduites: this.roundHours(entry.heuresDeduites),
        salaireCalcule,
        montantHoraireMoyen: heuresEffectuees > 0 ? this.roundMoney(salaireCalcule / heuresEffectuees) : 0,
      };
    });
  }

  private async assertCanControlSlot(tenantId: string, classeId: string, user?: JwtUser): Promise<void> {
    if (!user || user.role !== 'SURVEILLANT') return;
    const cycleIds = await this.visibleCycleIds(tenantId, user);
    if (!cycleIds) return;
    const classe = await this.prisma.classe.findFirst({
      where: { id: classeId, tenantId, niveau: { cycleId: { in: cycleIds } } },
      select: { id: true },
    });
    if (!classe) throw new BadRequestException('Cette classe n’est pas dans votre périmètre de surveillance');
  }

  /**
   * Déléguée à `CycleScopeService` pour que la règle soit unique.
   * L'implémentation locale renvoyait `null` — donc « aucun filtre » — quand le
   * surveillant n'avait aucun cycle affecté, ce qui lui ouvrait tout
   * l'établissement. Le service partagé renvoie désormais un tableau vide.
   */
  private visibleCycleIds(tenantId: string, user?: JwtUser): Promise<string[] | null> {
    return this.cycleScope.visibleCycleIds(tenantId, user);
  }

  private parseDate(value: string): Date {
    const raw = String(value ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      throw new BadRequestException('Date invalide');
    }
    return new Date(`${raw}T00:00:00.000Z`);
  }

  private normalizeStatut(value: unknown): StatutPresence {
    const statut = String(value ?? '').trim().toUpperCase();
    if (statut !== 'PRESENT' && statut !== 'ABSENT' && statut !== 'RETARD') {
      throw new BadRequestException('Statut invalide');
    }
    return statut as StatutPresence;
  }

  private minutesForStatus(minutesPlanifiees: number, statut: StatutPresence): number {
    if (statut === 'PRESENT') return minutesPlanifiees;
    if (statut === 'RETARD') return Math.round(minutesPlanifiees * 0.5);
    return 0;
  }

  private minutesBetween(start: string, end: string): number {
    const startMinutes = this.parseTime(start);
    const endMinutes = this.parseTime(end);
    if (endMinutes <= startMinutes) throw new BadRequestException('Horaire de cours invalide');
    return endMinutes - startMinutes;
  }

  private parseTime(value: string): number {
    const match = /^(\d{2}):(\d{2})$/.exec(String(value ?? ''));
    if (!match) throw new BadRequestException('Heure invalide');
    return Number(match[1]) * 60 + Number(match[2]);
  }

  private cleanObservation(value: unknown): string | null {
    const text = String(value ?? '').trim();
    return text ? text.slice(0, 500) : null;
  }

  private cleanRequiredText(value: unknown, message: string): string {
    const text = String(value ?? '').trim();
    if (!text) throw new BadRequestException(message);
    return text.slice(0, 500);
  }

  private async findTeacherPendingPayment(tenantId: string, paiementId: string, enseignantId: string) {
    const id = String(paiementId ?? '').trim();
    if (!id) throw new BadRequestException('paiementId est requis');
    const paiement = await this.prisma.paiementProfesseur.findFirst({
      where: { id, tenantId, enseignantId },
      select: {
        ...this.paiementProfesseurBaseSelect(),
        initialisePar: true,
      },
    });
    if (!paiement) throw new NotFoundException('Paiement professeur introuvable');
    if (paiement.statut !== 'EN_ATTENTE') {
      throw new BadRequestException('Ce paiement a déjà été traité');
    }
    return paiement;
  }

  private toPaiementResponse(row: {
    id: string;
    reference: string;
    dateDebut: Date;
    dateFin: Date;
    heuresEffectuees: number;
    heuresDeduites: number;
    montant: number;
    statut: string;
    observations: string | null;
    motifRejet?: string | null;
    reponduLe?: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      reference: row.reference,
      dateDebut: row.dateDebut,
      dateFin: row.dateFin,
      heuresEffectuees: row.heuresEffectuees,
      heuresDeduites: row.heuresDeduites,
      montant: row.montant,
      statut: row.statut,
      observations: row.observations,
      motifRejet: row.motifRejet ?? null,
      reponduLe: row.reponduLe ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private paiementProfesseurBaseSelect() {
    return {
      id: true,
      reference: true,
      dateDebut: true,
      dateFin: true,
      heuresEffectuees: true,
      heuresDeduites: true,
      montant: true,
      statut: true,
      observations: true,
      createdAt: true,
      updatedAt: true,
    };
  }

  private toPresenceResponse(row: {
    id: string;
    statut: StatutPresence;
    minutesPlanifiees: number;
    minutesComptabilisees: number;
    montantHoraire: number;
    salaireCalcule: number;
    observations: string | null;
    controlePar: string;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      statut: row.statut,
      minutesPlanifiees: row.minutesPlanifiees,
      minutesComptabilisees: row.minutesComptabilisees,
      heuresEffectuees: row.minutesComptabilisees / 60,
      montantHoraire: row.montantHoraire,
      salaireCalcule: row.salaireCalcule,
      observations: row.observations,
      controlePar: row.controlePar,
      updatedAt: row.updatedAt,
    };
  }

  private roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private roundHours(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
