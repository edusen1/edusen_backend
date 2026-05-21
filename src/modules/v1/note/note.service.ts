import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { buildPageResult, PageResult, PaginationQueryDto } from '@/shared/dto/pagination-query.dto';
import { Prisma, TypeEvaluation } from '@prisma/client';
import { rethrowServiceError } from '@/common/utils/service-error.util';

export interface CreateNoteDto {
  eleveId: string;
  matiereId: string;
  typeEvaluation: TypeEvaluation;
  note: number;
  noteSur?: number;
  trimestre: string;
  anneeScolaire: string;
  dateEvaluation?: string;
  commentaire?: string;
}

@Injectable()
export class NoteService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateNoteDto): Promise<unknown> {
    try {
      return await this.prisma.note.create({
        data: {
          tenantId,
          eleveId: dto.eleveId,
          matiereId: dto.matiereId,
          typeEvaluation: dto.typeEvaluation,
          note: dto.note,
          noteSur: dto.noteSur ?? 20,
          trimestre: dto.trimestre,
          anneeScolaire: dto.anneeScolaire,
          dateEvaluation: dto.dateEvaluation ? new Date(dto.dateEvaluation) : undefined,
          commentaire: dto.commentaire,
        },
        include: { matiere: { select: { id: true, code: true, libelle: true } } },
      });
    } catch (error) {
      rethrowServiceError(error, 'création note');
    }
  }

  async createMany(tenantId: string, notes: CreateNoteDto[]): Promise<unknown> {
    try {
      return await this.prisma.$transaction(
        notes.map((dto) =>
          this.prisma.note.create({
            data: {
              tenantId,
              eleveId: dto.eleveId,
              matiereId: dto.matiereId,
              typeEvaluation: dto.typeEvaluation,
              note: dto.note,
              noteSur: dto.noteSur ?? 20,
              trimestre: dto.trimestre,
              anneeScolaire: dto.anneeScolaire,
              dateEvaluation: dto.dateEvaluation ? new Date(dto.dateEvaluation) : undefined,
              commentaire: dto.commentaire,
            },
          }),
        ),
      );
    } catch (error) {
      rethrowServiceError(error, 'création multiple de notes');
    }
  }

  async findAll(
    tenantId: string,
    query: PaginationQueryDto & { eleveId?: string; trimestre?: string; anneeScolaire?: string; matiereId?: string },
  ): Promise<PageResult<unknown>> {
    const skip = ((query.page ?? 1) - 1) * (query.size ?? 20);
    const where: Prisma.NoteWhereInput = {
      tenantId,
      ...(query.eleveId ? { eleveId: query.eleveId } : {}),
      ...(query.trimestre ? { trimestre: query.trimestre } : {}),
      ...(query.anneeScolaire ? { anneeScolaire: query.anneeScolaire } : {}),
      ...(query.matiereId ? { matiereId: query.matiereId } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.note.findMany({
        where,
        skip,
        take: query.size ?? 20,
        orderBy: { createdAt: 'desc' },
        include: { matiere: { select: { id: true, code: true, libelle: true } } },
      }),
      this.prisma.note.count({ where }),
    ]);

    return buildPageResult(data, total, query.page ?? 1, query.size ?? 20);
  }

  async findOne(tenantId: string, id: string): Promise<unknown> {
    const note = await this.prisma.note.findFirst({
      where: { id, tenantId },
      include: { matiere: true },
    });
    if (!note) throw new NotFoundException('Note introuvable');
    return note;
  }

  async update(tenantId: string, id: string, dto: Partial<CreateNoteDto>): Promise<unknown> {
    await this.findOne(tenantId, id);
    return this.prisma.note.update({
      where: { id },
      data: {
        ...(dto.note !== undefined ? { note: dto.note } : {}),
        ...(dto.noteSur !== undefined ? { noteSur: dto.noteSur } : {}),
        ...(dto.typeEvaluation ? { typeEvaluation: dto.typeEvaluation } : {}),
        ...(dto.commentaire !== undefined ? { commentaire: dto.commentaire } : {}),
        ...(dto.dateEvaluation ? { dateEvaluation: new Date(dto.dateEvaluation) } : {}),
      },
      include: { matiere: { select: { id: true, code: true, libelle: true } } },
    });
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await this.findOne(tenantId, id);
    await this.prisma.note.delete({ where: { id } });
  }

  async getEleveNotes(
    tenantId: string,
    eleveId: string,
    trimestre: string,
    anneeScolaire: string,
  ): Promise<unknown[]> {
    return this.prisma.note.findMany({
      where: { tenantId, eleveId, trimestre, anneeScolaire },
      include: { matiere: { select: { id: true, code: true, libelle: true } } },
      orderBy: { matiere: { libelle: 'asc' } },
    });
  }

  async getMoyenneEleve(
    tenantId: string,
    eleveId: string,
    trimestre: string,
    anneeScolaire: string,
  ): Promise<{ moyenne: number; details: unknown[] }> {
    const notes = await this.prisma.note.findMany({
      where: { tenantId, eleveId, trimestre, anneeScolaire },
      include: { matiere: { select: { libelle: true, code: true } } },
    });

    if (notes.length === 0) return { moyenne: 0, details: [] };

    const coefficients = await this.getCourseCoefficientsForStudent(tenantId, eleveId, anneeScolaire);
    const byMatiere = new Map<string, { sum: number; count: number; coeff: number; libelle: string }>();
    for (const n of notes) {
      const normalized = (n.note / n.noteSur) * 20;
      const existing = byMatiere.get(n.matiereId);
      if (existing) {
        existing.sum += normalized;
        existing.count += 1;
      } else {
        byMatiere.set(n.matiereId, {
          sum: normalized,
          count: 1,
          coeff: coefficients.get(n.matiereId) ?? 1,
          libelle: n.matiere.libelle,
        });
      }
    }

    let totalPoints = 0;
    let totalCoeff = 0;
    const details: unknown[] = [];

    for (const [matiereId, v] of byMatiere) {
      const moyenneMatiere = v.sum / v.count;
      totalPoints += moyenneMatiere * v.coeff;
      totalCoeff += v.coeff;
      details.push({ matiereId, libelle: v.libelle, moyenne: Math.round(moyenneMatiere * 100) / 100, coefficient: v.coeff });
    }

    const moyenne = totalCoeff > 0 ? Math.round((totalPoints / totalCoeff) * 100) / 100 : 0;
    return { moyenne, details };
  }

  private async getCourseCoefficientsForStudent(
    tenantId: string,
    eleveId: string,
    anneeScolaire: string,
  ): Promise<Map<string, number>> {
    const inscription = await this.prisma.inscription.findFirst({
      where: { tenantId, eleveId, anneeAcademique: { libelle: anneeScolaire } },
      select: { classeId: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!inscription?.classeId) return new Map();

    const cours = await this.prisma.cours.findMany({
      where: {
        tenantId,
        classeId: inscription.classeId,
        OR: [
          { anneeAcademique: { libelle: anneeScolaire } },
          { anneeAcademiqueId: null },
        ],
      },
      select: { matiereId: true, coefficient: true },
    });

    return new Map(cours.map((row) => [row.matiereId, row.coefficient ?? 1]));
  }
}
