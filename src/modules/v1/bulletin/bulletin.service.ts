import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { MailService } from '@/infrastructure/mail/mail.service';
import { WhatsappService } from '@/modules/whatsapp/whatsapp.service';
import { buildPageResult, PageResult, PaginationQueryDto } from '@/shared/dto/pagination-query.dto';
import { Prisma, StatutBulletin } from '@prisma/client';

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

@Injectable()
export class BulletinService {
  private readonly logger = new Logger(BulletinService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly whatsapp: WhatsappService,
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
    const inscriptions = await this.prisma.inscription.findMany({
      where: { tenantId, classeId, statut: 'ACTIF' },
    });

    const totalEleves = inscriptions.length;
    const bulletins: unknown[] = [];
    const coefficients = await this.getCourseCoefficients(tenantId, classeId, anneeScolaire);

    for (const inscription of inscriptions) {
      const notes = await this.prisma.note.findMany({
        where: { tenantId, eleveId: inscription.eleveId, trimestre, anneeScolaire },
      });

      const { moyenne } = this.calculerMoyenne(notes, coefficients);

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
          data: { moyenne, totalEleves, nombreAbsences: absences },
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

    const updated = await this.prisma.bulletin.update({
      where: { id },
      data: { statut: StatutBulletin.PUBLIE, validePar },
    });

    const eleve = await this.prisma.user.findUnique({ where: { id: bulletin.eleveId } });
    if (eleve) {
      const nomEleve = `${eleve.firstName} ${eleve.lastName}`;
      const trimestre = (bulletin.trimestre ?? '').replace(/_/g, ' ');
      const parents = await this.prisma.eleveParent.findMany({
        where: { eleveId: eleve.id },
        include: { parent: { select: { email: true, firstName: true, telephone: true } } },
      });
      for (const { parent } of parents) {
        if (parent.email) {
          this.mailService.sendBulletinDisponible(parent.email, nomEleve, bulletin.trimestre);
        }
        if (parent.telephone) {
          const msg = `📋 *Bulletin disponible*\nBonjour ${parent.firstName ?? ''},\nLe bulletin de *${nomEleve}* pour le *${trimestre}* est maintenant disponible. Connectez-vous pour le consulter.`;
          this.whatsapp.sendMessage(tenantId, parent.telephone, msg).catch((e) =>
            this.logger.warn(`WhatsApp bulletin parent ${parent.telephone}: ${e?.message}`),
          );
        }
      }
      // Notify the student if they have a phone
      const eleveFull = await this.prisma.user.findUnique({ where: { id: eleve.id }, select: { telephone: true } });
      if (eleveFull?.telephone) {
        const msg = `📋 *Ton bulletin est disponible*\nBonjour ${eleve.firstName ?? ''},\nTon bulletin de *${trimestre}* est disponible. Connecte-toi pour le consulter.`;
        this.whatsapp.sendMessage(tenantId, eleveFull.telephone, msg).catch((e) =>
          this.logger.warn(`WhatsApp bulletin élève ${eleveFull.telephone}: ${e?.message}`),
        );
      }
    }

    return updated;
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
    // Return the bulletin with a duplicata flag for the frontend to generate a new PDF
    return { ...bulletin, isDuplicata: true, duplicataDate: new Date(), duplicataDemandePar: demandePar };
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await this.findOne(tenantId, id);
    await this.prisma.bulletin.delete({ where: { id } });
  }

  private calculerMoyenne(
    notes: { note: number; noteSur: number; matiereId: string }[],
    coefficients: Map<string, number>,
  ): { moyenne: number } {
    if (notes.length === 0) return { moyenne: 0 };
    let totalPoints = 0;
    let totalCoeff = 0;
    for (const n of notes) {
      const coefficient = coefficients.get(n.matiereId) ?? 1;
      const normalized = (n.note / n.noteSur) * 20;
      totalPoints += normalized * coefficient;
      totalCoeff += coefficient;
    }
    return { moyenne: totalCoeff > 0 ? Math.round((totalPoints / totalCoeff) * 100) / 100 : 0 };
  }

  private async getCourseCoefficients(tenantId: string, classeId: string, anneeScolaire: string): Promise<Map<string, number>> {
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
      orderBy: { moyenne: 'desc' },
    });

    const updates = bulletins.map((b, idx) =>
      this.prisma.bulletin.update({ where: { id: b.id }, data: { rang: idx + 1 } }),
    );

    await this.prisma.$transaction(updates);
  }
}
