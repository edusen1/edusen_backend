import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { buildPageResult, PageResult, PaginationQueryDto } from '@/shared/dto/pagination-query.dto';

export interface CreateMatiereDto {
  code: string;
  libelle: string;
  description?: string;
  actif?: boolean;
}

export interface CreateMatiereClasseDto {
  matiereId: string;
  classeId: string;
  enseignantId: string;
  anneeAcademiqueId: string;
  anneeScolaire: string;
  volumeHoraire?: number;
}

@Injectable()
export class MatiereService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateMatiereDto): Promise<unknown> {
    const existing = await this.prisma.matiere.findFirst({ where: { tenantId, code: dto.code } });
    if (existing) throw new ConflictException('Code matière déjà utilisé');

    return this.prisma.matiere.create({
      data: { tenantId, code: dto.code, libelle: dto.libelle, description: dto.description, actif: dto.actif ?? true },
    });
  }

  async findAll(tenantId: string, query: PaginationQueryDto): Promise<PageResult<unknown>> {
    const skip = ((query.page ?? 1) - 1) * (query.size ?? 20);
    const [data, total] = await Promise.all([
      this.prisma.matiere.findMany({
        where: {
          tenantId,
          ...(query.search
            ? { OR: [{ libelle: { contains: query.search, mode: 'insensitive' } }, { code: { contains: query.search, mode: 'insensitive' } }] }
            : {}),
        },
        skip,
        take: query.size ?? 20,
        orderBy: { libelle: 'asc' },
      }),
      this.prisma.matiere.count({ where: { tenantId } }),
    ]);
    return buildPageResult(data, total, query.page ?? 1, query.size ?? 20);
  }

  async findOne(tenantId: string, id: string): Promise<unknown> {
    const m = await this.prisma.matiere.findFirst({ where: { id, tenantId } });
    if (!m) throw new NotFoundException('Matière introuvable');
    return m;
  }

  async update(tenantId: string, id: string, dto: Partial<CreateMatiereDto>): Promise<unknown> {
    await this.findOne(tenantId, id);
    return this.prisma.matiere.update({ where: { id }, data: dto });
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await this.findOne(tenantId, id);
    await this.prisma.matiere.delete({ where: { id } });
  }

  // MatiereClasse
  async assignerClasse(tenantId: string, dto: CreateMatiereClasseDto): Promise<unknown> {
    return this.prisma.matiereClasse.upsert({
      where: {
        matiereId_classeId_enseignantId_anneeAcademiqueId: {
          matiereId: dto.matiereId,
          classeId: dto.classeId,
          enseignantId: dto.enseignantId,
          anneeAcademiqueId: dto.anneeAcademiqueId,
        },
      },
      update: { volumeHoraire: dto.volumeHoraire },
      create: {
        tenantId,
        matiereId: dto.matiereId,
        classeId: dto.classeId,
        enseignantId: dto.enseignantId,
        anneeAcademiqueId: dto.anneeAcademiqueId,
        anneeScolaire: dto.anneeScolaire,
        volumeHoraire: dto.volumeHoraire,
      },
      include: {
        matiere: { select: { id: true, code: true, libelle: true } },
        classe: { select: { id: true, nom: true } },
        enseignant: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async getMatieresByClasse(tenantId: string, classeId: string, anneeAcademiqueId?: string): Promise<unknown[]> {
    return this.prisma.matiereClasse.findMany({
      where: { tenantId, classeId, ...(anneeAcademiqueId ? { anneeAcademiqueId } : {}) },
      include: {
        matiere: true,
        enseignant: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }
}
