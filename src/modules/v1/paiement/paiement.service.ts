import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { MailService } from '@/infrastructure/mail/mail.service';
import { buildPageResult, PageResult, PaginationQueryDto } from '@/shared/dto/pagination-query.dto';
import { ModePaiement, Prisma, StatutPaiement, TypePaiement } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { rethrowServiceError } from '@/common/utils/service-error.util';

export interface CreatePaiementDto {
  eleveId: string;
  inscriptionId?: string;
  parentId?: string;
  montant: number;
  typePaiement: TypePaiement;
  modePaiement: ModePaiement;
  anneeScolaire: string;
  trimestre?: string;
  description?: string;
  transactionId?: string;
  datePaiement?: string;
}

@Injectable()
export class PaiementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  async create(tenantId: string, dto: CreatePaiementDto, validePar?: string): Promise<unknown> {
    try {
      const reference = this.generateReference();

      const paiement = await this.prisma.paiement.create({
        data: {
          tenantId,
          eleveId: dto.eleveId,
          inscriptionId: dto.inscriptionId,
          parentId: dto.parentId,
          reference,
          montant: dto.montant,
          typePaiement: dto.typePaiement,
          modePaiement: dto.modePaiement,
          statut: StatutPaiement.VALIDE,
          anneeScolaire: dto.anneeScolaire,
          trimestre: dto.trimestre,
          description: dto.description,
          transactionId: dto.transactionId,
          datePaiement: dto.datePaiement ? new Date(dto.datePaiement) : new Date(),
          validePar,
        },
      });

      const eleve = await this.prisma.user.findUnique({ where: { id: dto.eleveId } });
      if (dto.parentId) {
        const parent = await this.prisma.user.findUnique({ where: { id: dto.parentId } });
        if (parent?.email && eleve) {
          this.mailService.sendNotificationPaiement(
            parent.email,
            `${eleve.firstName} ${eleve.lastName}`,
            dto.montant,
            reference,
          );
        }
      }
      return paiement;
    } catch (error) {
      rethrowServiceError(error, 'creation paiement');
    }
  }

  async findAll(
    tenantId: string,
    query: PaginationQueryDto & {
      eleveId?: string;
      statut?: StatutPaiement;
      anneeScolaire?: string;
      trimestre?: string;
    },
  ): Promise<PageResult<unknown>> {
    const skip = ((query.page ?? 1) - 1) * (query.size ?? 20);
    const where: Prisma.PaiementWhereInput = {
      tenantId,
      ...(query.eleveId ? { eleveId: query.eleveId } : {}),
      ...(query.statut ? { statut: query.statut } : {}),
      ...(query.anneeScolaire ? { anneeScolaire: query.anneeScolaire } : {}),
      ...(query.trimestre ? { trimestre: query.trimestre } : {}),
      ...(query.search
        ? {
            OR: [
              { reference: { contains: query.search, mode: 'insensitive' } },
              { transactionId: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.paiement.findMany({
        where,
        skip,
        take: query.size ?? 20,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.paiement.count({ where }),
    ]);

    return buildPageResult(data, total, query.page ?? 1, query.size ?? 20);
  }

  async findOne(tenantId: string, id: string): Promise<unknown> {
    const p = await this.prisma.paiement.findFirst({ where: { id, tenantId } });
    if (!p) throw new NotFoundException('Paiement introuvable');
    return p;
  }

  async valider(tenantId: string, id: string, validePar: string): Promise<unknown> {
    await this.findOne(tenantId, id);
    return this.prisma.paiement.update({
      where: { id },
      data: { statut: StatutPaiement.VALIDE, validePar },
    });
  }

  async rejeter(tenantId: string, id: string): Promise<unknown> {
    await this.findOne(tenantId, id);
    return this.prisma.paiement.update({ where: { id }, data: { statut: StatutPaiement.REJETE } });
  }

  async getStatsByClasse(tenantId: string, classeId: string, anneeScolaire: string): Promise<unknown> {
    const inscriptions = await this.prisma.inscription.findMany({
      where: { tenantId, classeId, statut: 'ACTIF' },
    });

    const stats = await Promise.all(
      inscriptions.map(async (i) => {
        const total = await this.prisma.paiement.aggregate({
          where: { tenantId, eleveId: i.eleveId, anneeScolaire, statut: StatutPaiement.VALIDE },
          _sum: { montant: true },
          _count: true,
        });
        return { eleveId: i.eleveId, totalPaye: total._sum.montant ?? 0, nombrePaiements: total._count };
      }),
    );

    return stats;
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await this.findOne(tenantId, id);
    await this.prisma.paiement.delete({ where: { id } });
  }

  private generateReference(): string {
    const ts = Date.now().toString(36).toUpperCase();
    const rand = randomBytes(3).toString('hex').toUpperCase();
    return `PAY-${ts}-${rand}`;
  }
}
