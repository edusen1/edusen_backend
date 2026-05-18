import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { buildPageResult, PageResult, PaginationQueryDto } from '@/shared/dto/pagination-query.dto';
import { Prisma, StatutAbsenceEleve, TypeAbsence } from '@prisma/client';

export interface CreateAbsenceEleveDto {
  eleveId: string;
  classeId: string;
  date: string;
  typeAbsence?: TypeAbsence;
  motif?: string;
  justifiee?: boolean;
  documentUrl?: string;
}

@Injectable()
export class AbsenceEleveService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateAbsenceEleveDto): Promise<unknown> {
    return this.prisma.absenceEleve.create({
      data: {
        tenantId,
        eleveId: dto.eleveId,
        classeId: dto.classeId,
        date: new Date(dto.date),
        typeAbsence: dto.typeAbsence ?? TypeAbsence.ABSENT,
        motif: dto.motif,
        justifiee: dto.justifiee ?? false,
        documentUrl: dto.documentUrl,
        statut: StatutAbsenceEleve.EN_ATTENTE,
      },
      include: { classe: { select: { id: true, nom: true } } },
    });
  }

  async createBulk(tenantId: string, absences: CreateAbsenceEleveDto[]): Promise<unknown> {
    return this.prisma.$transaction(
      absences.map((dto) =>
        this.prisma.absenceEleve.create({
          data: {
            tenantId,
            eleveId: dto.eleveId,
            classeId: dto.classeId,
            date: new Date(dto.date),
            typeAbsence: dto.typeAbsence ?? TypeAbsence.ABSENT,
            motif: dto.motif,
            justifiee: dto.justifiee ?? false,
            statut: StatutAbsenceEleve.EN_ATTENTE,
          },
        }),
      ),
    );
  }

  async findAll(
    tenantId: string,
    query: PaginationQueryDto & { eleveId?: string; classeId?: string; date?: string },
  ): Promise<PageResult<unknown>> {
    const skip = ((query.page ?? 1) - 1) * (query.size ?? 20);
    const where: Prisma.AbsenceEleveWhereInput = {
      tenantId,
      ...(query.eleveId ? { eleveId: query.eleveId } : {}),
      ...(query.classeId ? { classeId: query.classeId } : {}),
      ...(query.date ? { date: new Date(query.date) } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.absenceEleve.findMany({
        where,
        skip,
        take: query.size ?? 20,
        orderBy: { date: 'desc' },
        include: { classe: { select: { id: true, nom: true } } },
      }),
      this.prisma.absenceEleve.count({ where }),
    ]);

    return buildPageResult(data, total, query.page ?? 1, query.size ?? 20);
  }

  async findOne(tenantId: string, id: string): Promise<unknown> {
    const a = await this.prisma.absenceEleve.findFirst({ where: { id, tenantId } });
    if (!a) throw new NotFoundException('Absence introuvable');
    return a;
  }

  async justifier(tenantId: string, id: string, motif: string, approuvePar: string): Promise<unknown> {
    await this.findOne(tenantId, id);
    return this.prisma.absenceEleve.update({
      where: { id },
      data: { justifiee: true, motif, statut: StatutAbsenceEleve.JUSTIFIEE, approuvePar },
    });
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await this.findOne(tenantId, id);
    await this.prisma.absenceEleve.delete({ where: { id } });
  }

  async getAbsencesByEleve(
    tenantId: string,
    eleveId: string,
    options?: { dateDebut?: string; dateFin?: string },
  ): Promise<{ total: number; justifiees: number; nonJustifiees: number; retards: number }> {
    const where: Prisma.AbsenceEleveWhereInput = {
      tenantId,
      eleveId,
      ...(options?.dateDebut || options?.dateFin
        ? {
            date: {
              ...(options?.dateDebut ? { gte: new Date(options.dateDebut) } : {}),
              ...(options?.dateFin ? { lte: new Date(options.dateFin) } : {}),
            },
          }
        : {}),
    };

    const [total, justifiees, retards] = await Promise.all([
      this.prisma.absenceEleve.count({ where: { ...where, typeAbsence: TypeAbsence.ABSENT } }),
      this.prisma.absenceEleve.count({ where: { ...where, justifiee: true } }),
      this.prisma.absenceEleve.count({ where: { ...where, typeAbsence: TypeAbsence.RETARD } }),
    ]);

    return { total: total + retards, justifiees, nonJustifiees: total - justifiees, retards };
  }
}
