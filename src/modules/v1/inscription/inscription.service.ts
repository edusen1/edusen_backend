import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { buildPageResult, PageResult, PaginationQueryDto } from '@/shared/dto/pagination-query.dto';
import { Prisma, StatutInscription } from '@prisma/client';
import { rethrowServiceError } from '@/common/utils/service-error.util';

export interface CreateInscriptionDto {
  eleveId: string;
  classeId: string;
  anneeAcademiqueId: string;
  fraisInscription?: number | null;
}

@Injectable()
export class InscriptionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateInscriptionDto, creePar: string): Promise<unknown> {
    try {
      const existing = await this.prisma.inscription.findFirst({
        where: { tenantId, eleveId: dto.eleveId, anneeAcademiqueId: dto.anneeAcademiqueId },
        select: { id: true, statut: true },
      });
      if (existing) {
        if (existing.statut === StatutInscription.EXCLU) {
          throw new BadRequestException('ELEVE_EXCLU: cet élève est exclu pour cette année scolaire');
        }
        throw new BadRequestException('INSCRIPTION_DEJA_EXISTANTE: cet élève est déjà inscrit pour cette année scolaire');
      }

      const numeroInscription = this.generateNumero(tenantId);
      return await this.prisma.inscription.create({
        data: {
          tenantId,
          numeroInscription,
          eleveId: dto.eleveId,
          classeId: dto.classeId,
          anneeAcademiqueId: dto.anneeAcademiqueId,
          fraisInscription: dto.fraisInscription ?? null,
          statut: StatutInscription.ACTIF,
          creePar,
        },
        include: {
          classe: { select: { id: true, nom: true } },
          anneeAcademique: { select: { id: true, libelle: true } },
        },
      });
    } catch (error) {
      rethrowServiceError(error, 'création inscription');
    }
  }

  async findAll(
    tenantId: string,
    query: PaginationQueryDto & { eleveId?: string; classeId?: string; anneeAcademiqueId?: string },
  ): Promise<PageResult<unknown>> {
    const skip = ((query.page ?? 1) - 1) * (query.size ?? 20);
    const where: Prisma.InscriptionWhereInput = {
      tenantId,
      ...(query.eleveId ? { eleveId: query.eleveId } : {}),
      ...(query.classeId ? { classeId: query.classeId } : {}),
      ...(query.anneeAcademiqueId ? { anneeAcademiqueId: query.anneeAcademiqueId } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.inscription.findMany({
        where,
        skip,
        take: query.size ?? 20,
        orderBy: { createdAt: 'desc' },
        include: {
          classe: { select: { id: true, nom: true } },
          anneeAcademique: { select: { id: true, libelle: true } },
        },
      }),
      this.prisma.inscription.count({ where }),
    ]);

    return buildPageResult(data, total, query.page ?? 1, query.size ?? 20);
  }

  async findOne(tenantId: string, id: string): Promise<unknown> {
    const i = await this.prisma.inscription.findFirst({
      where: { id, tenantId },
      include: { classe: true, anneeAcademique: true, paiements: true },
    });
    if (!i) throw new NotFoundException('Inscription introuvable');
    return i;
  }

  async changerStatut(tenantId: string, id: string, statut: StatutInscription): Promise<unknown> {
    await this.findOne(tenantId, id);
    return this.prisma.inscription.update({ where: { id }, data: { statut } });
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await this.findOne(tenantId, id);
    await this.prisma.inscription.delete({ where: { id } });
  }

  private generateNumero(tenantId: string): string {
    const ts = Date.now().toString(36).toUpperCase();
    return `INS-${tenantId.slice(0, 4).toUpperCase()}-${ts}`;
  }
}
