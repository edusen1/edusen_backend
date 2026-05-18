import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { buildPageResult, PageResult, PaginationQueryDto } from '@/shared/dto/pagination-query.dto';
import { Prisma, StatutAppel, StatutPresence } from '@prisma/client';

export interface LigneAppelDto {
  eleveId: string;
  statut: StatutPresence;
}

export interface CreateAppelDto {
  coursId: string;
  classeId?: string;
  dateCours: string;
  heureDebut?: string;
  lignes?: LigneAppelDto[];
}

@Injectable()
export class AppelService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateAppelDto, soumisPar: string): Promise<unknown> {
    return this.prisma.appel.create({
      data: {
        tenantId,
        coursId: dto.coursId,
        classeId: dto.classeId,
        dateCours: new Date(dto.dateCours),
        heureDebut: dto.heureDebut,
        statut: StatutAppel.BROUILLON,
        soumisPar,
        lignes: dto.lignes?.length
          ? {
              create: dto.lignes.map((l) => ({ eleveId: l.eleveId, statut: l.statut })),
            }
          : undefined,
      },
      include: {
        cours: { select: { id: true, matiere: { select: { libelle: true } } } },
        lignes: true,
      },
    });
  }

  async findAll(
    tenantId: string,
    query: PaginationQueryDto & { coursId?: string; classeId?: string; date?: string },
  ): Promise<PageResult<unknown>> {
    const skip = ((query.page ?? 1) - 1) * (query.size ?? 20);
    const where: Prisma.AppelWhereInput = {
      tenantId,
      ...(query.coursId ? { coursId: query.coursId } : {}),
      ...(query.classeId ? { classeId: query.classeId } : {}),
      ...(query.date ? { dateCours: new Date(query.date) } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.appel.findMany({
        where,
        skip,
        take: query.size ?? 20,
        orderBy: { dateCours: 'desc' },
        include: { cours: { include: { matiere: true } }, _count: { select: { lignes: true } } },
      }),
      this.prisma.appel.count({ where }),
    ]);

    return buildPageResult(data, total, query.page ?? 1, query.size ?? 20);
  }

  async findOne(tenantId: string, id: string): Promise<unknown> {
    const appel = await this.prisma.appel.findFirst({
      where: { id, tenantId },
      include: {
        cours: { include: { matiere: true } },
        lignes: true,
      },
    });
    if (!appel) throw new NotFoundException('Appel introuvable');
    return appel;
  }

  async soumettre(tenantId: string, id: string): Promise<unknown> {
    const appel = await this.prisma.appel.findFirst({ where: { id, tenantId } });
    if (!appel) throw new NotFoundException('Appel introuvable');
    return this.prisma.appel.update({ where: { id }, data: { statut: StatutAppel.SOUMIS } });
  }

  async updateLignes(tenantId: string, id: string, lignes: LigneAppelDto[]): Promise<unknown> {
    await this.findOne(tenantId, id);

    await this.prisma.appelLigne.deleteMany({ where: { appelId: id } });
    await this.prisma.appelLigne.createMany({
      data: lignes.map((l) => ({ appelId: id, eleveId: l.eleveId, statut: l.statut })),
    });

    return this.findOne(tenantId, id);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await this.findOne(tenantId, id);
    await this.prisma.appel.delete({ where: { id } });
  }
}
