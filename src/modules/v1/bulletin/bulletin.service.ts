import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { MailService } from '@/infrastructure/mail/mail.service';
import { WhatsappService } from '@/modules/whatsapp/whatsapp.service';
import { buildPageResult, PageResult, PaginationQueryDto } from '@/shared/dto/pagination-query.dto';
import { Prisma, StatutBulletin } from '@prisma/client';
import { PushNotificationService } from '@/modules/push-notification.service';
import { BulletinDocumentService } from '@/modules/bulletin-document.service';
import { StorageService } from '@/infrastructure/storage/storage.service';
import { calculateBulletinAverages, BulletinGradeInput } from '@/common/utils/bulletin-calculation.util';

export interface CreateBulletinDto {
  eleveId: string;
  classeId: string;
  trimestre: string;
  anneeScolaire: string;
  moyenne?: number;
  moyenneClasse?: number;
  rang?: number;
  totalEleves?: number;
  appreciation?: string;
  nombreAbsences?: number;
  nombreRetards?: number;
}

export interface PublishBulletinsDto {
  portee: 'CLASSE' | 'CYCLE' | 'TOUS';
  trimestre: string;
  anneeScolaire: string;
  classeId?: string;
  cycleId?: string;
}

@Injectable()
export class BulletinService {
  private readonly logger = new Logger(BulletinService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly whatsapp: WhatsappService,
    private readonly pushNotifications: PushNotificationService,
    private readonly bulletinDocument: BulletinDocumentService,
    private readonly storage: StorageService,
  ) {}

  async create(tenantId: string, dto: CreateBulletinDto, soumisPar?: string): Promise<unknown> {
    return this.prisma.bulletin.create({
      data: {
        tenantId,
        eleveId: dto.eleveId,
        classeId: dto.classeId,
        trimestre: dto.trimestre,
        anneeScolaire: dto.anneeScolaire,
        moyenne: dto.moyenne,
        moyenneClasse: dto.moyenneClasse,
        rang: dto.rang,
        totalEleves: dto.totalEleves,
        appreciation: dto.appreciation,
        nombreAbsences: dto.nombreAbsences ?? 0,
        nombreRetards: dto.nombreRetards ?? 0,
        statut: StatutBulletin.BROUILLON,
        soumisPar,
      },
      include: { classe: { select: { id: true, nom: true } } },
    });
  }

  async generateBulletins(
    tenantId: string,
    classeId: string,
    trimestre: string,
    anneeScolaire: string,
    soumisPar: string,
  ): Promise<unknown[]> {
    const [inscriptions, classe] = await Promise.all([
      this.prisma.inscription.findMany({ where: { tenantId, classeId, statut: 'ACTIF' } }),
      this.prisma.classe.findUnique({ where: { id: classeId }, select: { niveauId: true } }),
    ]);

    const totalEleves = inscriptions.length;
    const studentIds = inscriptions.map((i) => i.eleveId);

    // Coefficients depuis MatiereNiveau (source de vérité)
    const coefficients = await this.getMatiereNiveauCoefficients(tenantId, classeId, classe?.niveauId ?? null, anneeScolaire);

    // Charger toutes les notes de la classe en une fois
    const allNotes = await this.prisma.note.findMany({
      where: { tenantId, eleveId: { in: studentIds }, trimestre, anneeScolaire },
    });

    const gradeInputs: BulletinGradeInput[] = allNotes.map((n) => ({
      eleveId: n.eleveId,
      matiereId: n.matiereId,
      note: n.note as number,
      noteSur: (n.noteSur as number) ?? 20,
      typeEvaluation: n.typeEvaluation ?? 'DEVOIR',
    }));

    const averages = calculateBulletinAverages(studentIds, gradeInputs, coefficients);

    // Moyenne classe
    const avgValues = [...averages.values()].filter((v) => v > 0 || studentIds.length > 0);
    const moyenneClasse = avgValues.length > 0
      ? Math.round((avgValues.reduce((s, v) => s + v, 0) / avgValues.length) * 100) / 100
      : null;

    const bulletins: unknown[] = [];

    for (const inscription of inscriptions) {
      const moyenne = averages.get(inscription.eleveId) ?? 0;
      const absences = await this.prisma.absenceEleve.count({
        where: { tenantId, eleveId: inscription.eleveId },
      });

      const existing = await this.prisma.bulletin.findFirst({
        where: { tenantId, eleveId: inscription.eleveId, classeId, trimestre, anneeScolaire },
      });

      let bulletin;
      if (existing) {
        bulletin = await this.prisma.bulletin.update({
          where: { id: existing.id },
          data: {
            moyenne,
            moyenneClasse,
            totalEleves,
            nombreAbsences: absences,
            statut: StatutBulletin.BROUILLON,
            validePar: null,
            fichierPdfUrl: null,
          },
        });
      } else {
        bulletin = await this.prisma.bulletin.create({
          data: {
            tenantId,
            eleveId: inscription.eleveId,
            classeId,
            trimestre,
            anneeScolaire,
            moyenne,
            moyenneClasse,
            totalEleves,
            nombreAbsences: absences,
            statut: StatutBulletin.BROUILLON,
            soumisPar,
          },
        });
      }

      bulletins.push(bulletin);
    }

    await this.updateRangs(tenantId, classeId, trimestre, anneeScolaire);
    return bulletins;
  }

  async findAll(
    tenantId: string,
    query: PaginationQueryDto & {
      eleveId?: string;
      classeId?: string;
      trimestre?: string;
      anneeScolaire?: string;
    },
  ): Promise<PageResult<unknown>> {
    const skip = ((query.page ?? 1) - 1) * (query.size ?? 20);
    const where: Prisma.BulletinWhereInput = {
      tenantId,
      ...(query.eleveId ? { eleveId: query.eleveId } : {}),
      ...(query.classeId ? { classeId: query.classeId } : {}),
      ...(query.trimestre ? { trimestre: query.trimestre } : {}),
      ...(query.anneeScolaire ? { anneeScolaire: query.anneeScolaire } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.bulletin.findMany({
        where,
        skip,
        take: query.size ?? 20,
        orderBy: { createdAt: 'desc' },
        include: { classe: { select: { id: true, nom: true } } },
      }),
      this.prisma.bulletin.count({ where }),
    ]);

    return buildPageResult(data, total, query.page ?? 1, query.size ?? 20);
  }

  async findOne(tenantId: string, id: string): Promise<unknown> {
    const bulletin = await this.prisma.bulletin.findFirst({
      where: { id, tenantId },
      include: {
        classe: { select: { id: true, nom: true } },
        liensBulletin: true,
      },
    });
    if (!bulletin) throw new NotFoundException('Bulletin introuvable');
    return bulletin;
  }

  async update(tenantId: string, id: string, dto: Partial<CreateBulletinDto>): Promise<unknown> {
    await this.findOne(tenantId, id);
    return this.prisma.bulletin.update({
      where: { id },
      data: dto,
      include: { classe: { select: { id: true, nom: true } } },
    });
  }

  async valider(tenantId: string, id: string, validePar: string): Promise<unknown> {
    const bulletin = await this.prisma.bulletin.findFirst({ where: { id, tenantId } });
    if (!bulletin) throw new NotFoundException('Bulletin introuvable');
    return this.prisma.bulletin.update({
      where: { id },
      data: { statut: StatutBulletin.VALIDE, validePar },
    });
  }

  async publier(tenantId: string, id: string, validePar: string): Promise<unknown> {
    const bulletin = await this.prisma.bulletin.findFirst({ where: { id, tenantId } });
    if (!bulletin) throw new NotFoundException('Bulletin introuvable');

    const transition = await this.prisma.bulletin.updateMany({
      where: { id, tenantId, statut: { not: StatutBulletin.PUBLIE } },
      data: { statut: StatutBulletin.PUBLIE, validePar },
    });
    if (transition.count === 0) return bulletin;

    await this.notifyPublication(tenantId, bulletin).catch((error: unknown) => {
      this.logger.error(`Notifications bulletin ${id} incomplètes`, error instanceof Error ? error.stack : String(error));
    });

    return this.prisma.bulletin.findUnique({ where: { id } });
  }

  async publierParClasse(
    tenantId: string,
    classeId: string,
    validePar: string,
    trimestre?: string,
    anneeScolaire?: string,
  ): Promise<{ classeId: string; trimestre: string; anneeScolaire: string; total: number; bulletins: unknown[] }> {
    return this.publierPlusieurs(
      tenantId,
      {
        portee: 'CLASSE',
        classeId,
        trimestre: trimestre ?? '',
        anneeScolaire: anneeScolaire ?? '',
      },
      validePar,
    ).then((result) => ({
      classeId,
      trimestre: trimestre ?? '',
      anneeScolaire: anneeScolaire ?? '',
      total: result.publishedCount,
      bulletins: [],
    }));
  }

  async publierPlusieurs(
    tenantId: string,
    dto: PublishBulletinsDto,
    validePar: string,
  ): Promise<{ publishedCount: number; matchedDraftCount: number }> {
    const portee = String(dto.portee ?? '').toUpperCase();
    const trimestre = String(dto.trimestre ?? '').trim().toUpperCase();
    const anneeScolaire = String(dto.anneeScolaire ?? '').trim();
    if (!['CLASSE', 'CYCLE', 'TOUS'].includes(portee)) {
      throw new BadRequestException('Portée de publication invalide');
    }
    if (!trimestre || !anneeScolaire) {
      throw new BadRequestException('Le trimestre et l’année scolaire sont obligatoires');
    }
    if (portee === 'CLASSE' && !dto.classeId) {
      throw new BadRequestException('La classe est obligatoire pour une publication par classe');
    }
    if (portee === 'CYCLE' && !dto.cycleId) {
      throw new BadRequestException('Le cycle est obligatoire pour une publication par cycle');
    }

    const where: Prisma.BulletinWhereInput = {
      tenantId,
      statut: StatutBulletin.BROUILLON,
      trimestre,
      anneeScolaire,
      ...(portee === 'CLASSE' ? { classeId: dto.classeId } : {}),
      ...(portee === 'CYCLE' ? { classe: { niveau: { cycleId: dto.cycleId } } } : {}),
    };
    const bulletins = await this.prisma.bulletin.findMany({ where });
    let publishedCount = 0;

    for (const bulletin of bulletins) {
      const transition = await this.prisma.bulletin.updateMany({
        where: { id: bulletin.id, tenantId, statut: StatutBulletin.BROUILLON },
        data: { statut: StatutBulletin.PUBLIE, validePar },
      });
      if (transition.count === 0) continue;
      publishedCount += 1;
      await this.notifyPublication(tenantId, bulletin).catch((error: unknown) => {
        this.logger.error(
          `Notifications bulletin ${bulletin.id} incomplètes`,
          error instanceof Error ? error.stack : String(error),
        );
      });
    }

    return { publishedCount, matchedDraftCount: bulletins.length };
  }

  private async notifyPublication(
    tenantId: string,
    bulletin: { id: string; eleveId: string; trimestre: string },
  ): Promise<void> {
    const eleve = await this.prisma.user.findUnique({ where: { id: bulletin.eleveId } });
    if (!eleve) return;

    const generated = await this.bulletinDocument.generate(tenantId, bulletin.id);
    const key = this.storage.buildBulletinKey(tenantId, bulletin.eleveId, bulletin.trimestre, (bulletin as any).anneeScolaire);
    const fichierPdfUrl = await this.storage.upload(key, generated.buffer, 'application/pdf').catch(() => null);
    if (fichierPdfUrl) {
      await this.prisma.bulletin.update({ where: { id: bulletin.id }, data: { fichierPdfUrl } }).catch(() => undefined);
    }

    const nomEleve = `${eleve.firstName} ${eleve.lastName}`;
    const trimestre = (bulletin.trimestre ?? '').replace(/_/g, ' ');
    const parents = await this.prisma.eleveParent.findMany({
      where: { eleveId: eleve.id },
      include: { parent: { select: { id: true, email: true, firstName: true, telephone: true } } },
    });
    const notificationTitle = 'Bulletin publié';
    const notificationBody = `Votre bulletin du ${trimestre} est disponible.`;
    const destinataires = [eleve.id, ...parents.map(({ parent }) => parent.id)];
    await this.prisma.notification.createMany({
      data: destinataires.map((destinataireId) => ({
        tenantId,
        destinataireId,
        titre: notificationTitle,
        contenu: notificationBody,
        lu: false,
      })),
    });
    await this.pushNotifications.sendToUsers(tenantId, destinataires, {
      title: notificationTitle,
      body: notificationBody,
    });
    for (const { parent } of parents) {
      if (parent.email) {
        this.mailService.sendBulletinDisponible(parent.email, nomEleve, bulletin.trimestre);
      }
      if (parent.telephone) {
        const caption = `Bulletin du ${trimestre} publié pour ${nomEleve}.`;
        this.whatsapp.sendDocument(tenantId, parent.telephone, {
          filename: generated.filename,
          mimeType: 'application/pdf',
          data: generated.buffer,
          caption,
        }).catch((e) =>
          this.logger.warn(`WhatsApp bulletin parent ${parent.telephone}: ${e?.message}`),
        );
      }
    }
    const eleveFull = await this.prisma.user.findUnique({ where: { id: eleve.id }, select: { telephone: true } });
    if (eleveFull?.telephone) {
      const msg = `📋 *Ton bulletin est disponible*\nBonjour ${eleve.firstName ?? ''},\nTon bulletin de *${trimestre}* est disponible. Connecte-toi pour le consulter.`;
      this.whatsapp.sendMessage(tenantId, eleveFull.telephone, msg).catch((e) =>
        this.logger.warn(`WhatsApp bulletin élève ${eleveFull.telephone}: ${e?.message}`),
      );
    }
  }

  async genererDuplicata(tenantId: string, id: string, demandePar: string): Promise<unknown> {
    const bulletin = await this.prisma.bulletin.findFirst({
      where: { id, tenantId },
      include: {
        classe: { select: { id: true, nom: true } },
        liensBulletin: { select: { token: true, createdAt: true } },
      },
    });
    if (!bulletin) throw new NotFoundException('Bulletin introuvable');
    this.logger.log(`Duplicata demandé pour bulletin ${id} par ${demandePar}`);
    return { ...bulletin, isDuplicata: true, duplicataDate: new Date(), duplicataDemandePar: demandePar };
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await this.findOne(tenantId, id);
    await this.prisma.bulletin.delete({ where: { id } });
  }

  private async getMatiereNiveauCoefficients(
    tenantId: string,
    classeId: string,
    niveauId: string | null,
    anneeScolaire: string,
  ): Promise<Map<string, number>> {
    // Source de vérité : MatiereNiveau (config admin)
    if (niveauId) {
      const matiereNiveaux = await this.prisma.matiereNiveau.findMany({
        where: { tenantId, niveauId },
        select: { matiereId: true, coefficient: true },
      });
      if (matiereNiveaux.length > 0) {
        return new Map(matiereNiveaux.map((mn) => [mn.matiereId, mn.coefficient ?? 1]));
      }
    }
    // Fallback : Cours.coefficient
    const cours = await this.prisma.cours.findMany({
      where: {
        tenantId,
        classeId,
        OR: [
          { anneeAcademique: { libelle: anneeScolaire } },
          { anneeAcademiqueId: null },
        ],
      },
      select: { matiereId: true, coefficient: true },
    });
    return new Map(cours.map((row) => [row.matiereId, row.coefficient ?? 1]));
  }

  private async updateRangs(tenantId: string, classeId: string, trimestre: string, anneeScolaire: string): Promise<void> {
    const bulletins = await this.prisma.bulletin.findMany({
      where: { tenantId, classeId, trimestre, anneeScolaire, moyenne: { not: null } },
    });

    // Sort in JavaScript to guarantee correct descending order (highest average = rank 1)
    bulletins.sort((a, b) => (Number(b.moyenne) || 0) - (Number(a.moyenne) || 0));

    const updates = bulletins.map((b, idx) =>
      this.prisma.bulletin.update({ where: { id: b.id }, data: { rang: idx + 1 } }),
    );

    await this.prisma.$transaction(updates);
  }
}
