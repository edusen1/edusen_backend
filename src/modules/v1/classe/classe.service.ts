import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { buildPageResult, PageResult, PaginationQueryDto } from '@/shared/dto/pagination-query.dto';
import { Prisma } from '@prisma/client';
import { rethrowServiceError } from '@/common/utils/service-error.util';

export interface CreateClasseDto {
  nom: string;
  niveauId?: string;
  anneeAcademiqueId?: string;
  salleId?: string;
  effectifMax?: number;
}

@Injectable()
export class ClasseService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateClasseDto): Promise<unknown> {
    try {
      const existing = await this.prisma.classe.findFirst({
        where: { tenantId, nom: dto.nom, anneeAcademiqueId: dto.anneeAcademiqueId ?? null },
      });
      if (existing) throw new ConflictException('Classe deja existante pour cette annee');

      return await this.prisma.classe.create({
        data: { tenantId, ...dto },
        include: {
          niveau: { select: { id: true, code: true, libelle: true } },
          anneeAcademique: { select: { id: true, libelle: true } },
          salle: { select: { id: true, nom: true } },
        },
      });
    } catch (error) {
      rethrowServiceError(error, 'creation classe');
    }
  }

  async findAll(tenantId: string, query: PaginationQueryDto, anneeAcademiqueId?: string): Promise<PageResult<unknown>> {
    const skip = ((query.page ?? 1) - 1) * (query.size ?? 20);
    const where: Prisma.ClasseWhereInput = {
      tenantId,
      ...(anneeAcademiqueId ? { anneeAcademiqueId } : {}),
      ...(query.search ? { nom: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.classe.findMany({
        where,
        skip,
        take: query.size ?? 20,
        orderBy: { nom: 'asc' },
        include: {
          niveau: { select: { id: true, code: true, libelle: true } },
          anneeAcademique: { select: { id: true, libelle: true } },
          _count: { select: { eleves: true, inscriptions: true } },
        },
      }),
      this.prisma.classe.count({ where }),
    ]);

    return buildPageResult(data, total, query.page ?? 1, query.size ?? 20);
  }

  async findOne(tenantId: string, id: string): Promise<unknown> {
    const classe = await this.prisma.classe.findFirst({
      where: { id, tenantId },
      include: {
        niveau: true,
        anneeAcademique: true,
        salle: { include: { batiment: true } },
        _count: { select: { eleves: true, inscriptions: true, cours: true } },
        matiereClasses: {
          include: {
            matiere: { select: { id: true, code: true, libelle: true } },
            enseignant: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    });
    if (!classe) throw new NotFoundException('Classe introuvable');
    return classe;
  }

  async update(tenantId: string, id: string, dto: Partial<CreateClasseDto>): Promise<unknown> {
    await this.findOne(tenantId, id);
    return this.prisma.classe.update({
      where: { id },
      data: dto,
      include: { niveau: true, anneeAcademique: true },
    });
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await this.findOne(tenantId, id);
    await this.prisma.classe.delete({ where: { id } });
  }

  async getEleves(tenantId: string, classeId: string): Promise<unknown[]> {
    return this.prisma.user.findMany({
      where: { tenantId, classeId, role: 'ELEVE' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        matricule: true,
        photoUrl: true,
        genre: true,
      },
      orderBy: { lastName: 'asc' },
    });
  }
}
