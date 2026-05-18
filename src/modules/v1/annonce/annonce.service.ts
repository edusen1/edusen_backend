import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { buildPageResult, PageResult, PaginationQueryDto } from '@/shared/dto/pagination-query.dto';

export interface CreateAnnonceDto {
  titre: string;
  contenu: string;
  dateDebut: string;
  dateFin?: string;
  actif?: boolean;
}

@Injectable()
export class AnnonceService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateAnnonceDto): Promise<unknown> {
    return this.prisma.annonce.create({
      data: {
        tenantId,
        titre: dto.titre,
        contenu: dto.contenu,
        dateDebut: new Date(dto.dateDebut),
        dateFin: dto.dateFin ? new Date(dto.dateFin) : undefined,
        actif: dto.actif ?? true,
      },
    });
  }

  async findAll(tenantId: string, query: PaginationQueryDto): Promise<PageResult<unknown>> {
    const skip = ((query.page ?? 1) - 1) * (query.size ?? 20);
    const now = new Date();

    const [data, total] = await Promise.all([
      this.prisma.annonce.findMany({
        where: { tenantId, actif: true, dateDebut: { lte: now }, OR: [{ dateFin: null }, { dateFin: { gte: now } }] },
        skip,
        take: query.size ?? 20,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.annonce.count({ where: { tenantId, actif: true } }),
    ]);

    return buildPageResult(data, total, query.page ?? 1, query.size ?? 20);
  }

  async findAllAdmin(tenantId: string, query: PaginationQueryDto): Promise<PageResult<unknown>> {
    const skip = ((query.page ?? 1) - 1) * (query.size ?? 20);

    const [data, total] = await Promise.all([
      this.prisma.annonce.findMany({
        where: { tenantId },
        skip,
        take: query.size ?? 20,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.annonce.count({ where: { tenantId } }),
    ]);

    return buildPageResult(data, total, query.page ?? 1, query.size ?? 20);
  }

  async findOne(tenantId: string, id: string): Promise<unknown> {
    const a = await this.prisma.annonce.findFirst({ where: { id, tenantId } });
    if (!a) throw new NotFoundException('Annonce introuvable');
    return a;
  }

  async update(tenantId: string, id: string, dto: Partial<CreateAnnonceDto>): Promise<unknown> {
    await this.findOne(tenantId, id);
    return this.prisma.annonce.update({
      where: { id },
      data: {
        ...dto,
        dateDebut: dto.dateDebut ? new Date(dto.dateDebut) : undefined,
        dateFin: dto.dateFin ? new Date(dto.dateFin) : undefined,
      },
    });
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await this.findOne(tenantId, id);
    await this.prisma.annonce.delete({ where: { id } });
  }
}
