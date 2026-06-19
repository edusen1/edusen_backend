import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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
      const data = this.toCreateData(tenantId, dto);
      await this.applyEvaluationRules(tenantId, data);
      const created = await this.prisma.note.create({
        data,
        include: { matiere: { select: { id: true, code: true, libelle: true } } },
      });
      return this.attachCoefficient(tenantId, created);
    } catch (error) {
      rethrowServiceError(error, 'création note');
    }
  }

  async createMany(tenantId: string, notes: CreateNoteDto[]): Promise<unknown> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = [];
        for (const dto of notes) {
          const data = this.toCreateData(tenantId, dto);
          await this.applyEvaluationRules(tenantId, data, undefined, tx);
          created.push(await tx.note.create({ data }));
        }
        return created;
      });
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

    const hydrated = await this.attachCoefficients(tenantId, data);
    return buildPageResult(hydrated, total, query.page ?? 1, query.size ?? 20);
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
    const data = {
      ...(dto.note !== undefined ? { note: dto.note } : {}),
      ...(dto.noteSur !== undefined ? { noteSur: dto.noteSur } : {}),
      ...(dto.typeEvaluation ? { typeEvaluation: dto.typeEvaluation } : {}),
      ...(dto.commentaire !== undefined ? { commentaire: dto.commentaire } : {}),
      ...(dto.dateEvaluation ? { dateEvaluation: new Date(dto.dateEvaluation) } : {}),
    };
    if (dto.typeEvaluation || dto.commentaire !== undefined) {
      await this.applyEvaluationRules(tenantId, data, id);
    }
    const updated = await this.prisma.note.update({
      where: { id },
      data,
      include: { matiere: { select: { id: true, code: true, libelle: true } } },
    });
    return this.attachCoefficient(tenantId, updated);
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
    const notes = await this.prisma.note.findMany({
      where: { tenantId, eleveId, trimestre, anneeScolaire },
      include: { matiere: { select: { id: true, code: true, libelle: true } } },
      orderBy: { matiere: { libelle: 'asc' } },
    });
    return this.attachCoefficients(tenantId, notes);
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

  private async attachCoefficients<T extends { eleveId?: string; anneeScolaire?: string; coefficient?: number | null }>(
    tenantId: string,
    notes: T[],
  ): Promise<T[]> {
    const cache = new Map<string, Map<string, number>>();
    const getCoefficients = async (eleveId: string, anneeScolaire: string): Promise<Map<string, number>> => {
      const key = `${eleveId}|${anneeScolaire}`;
      const cached = cache.get(key);
      if (cached) return cached;
      const map = await this.getCourseCoefficientsForStudent(tenantId, eleveId, anneeScolaire);
      cache.set(key, map);
      return map;
    };

    return Promise.all(notes.map(async (note) => {
      if (!note.eleveId || !note.anneeScolaire) return { ...note } as T;
      const coefficients = await getCoefficients(note.eleveId, note.anneeScolaire);
      return {
        ...note,
        coefficient: note.coefficient ?? coefficients.get((note as any).matiereId) ?? 1,
      };
    }));
  }

  private async attachCoefficient<T extends { eleveId?: string; anneeScolaire?: string; coefficient?: number | null }>(
    tenantId: string,
    note: T,
  ): Promise<T> {
    const [hydrated] = await this.attachCoefficients(tenantId, [note]);
    return hydrated;
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

  private toCreateData(tenantId: string, dto: CreateNoteDto): Prisma.NoteUncheckedCreateInput {
    return {
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
    };
  }

  private async applyEvaluationRules(
    tenantId: string,
    data: Record<string, any>,
    currentNoteId?: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    const current = currentNoteId
      ? await client.note.findFirst({
          where: { id: currentNoteId, tenantId },
          select: {
            eleveId: true,
            matiereId: true,
            typeEvaluation: true,
            trimestre: true,
            anneeScolaire: true,
            commentaire: true,
          },
        })
      : null;

    const eleveId = String(data.eleveId ?? current?.eleveId ?? '').trim();
    const matiereId = String(data.matiereId ?? current?.matiereId ?? '').trim();
    const trimestre = String(data.trimestre ?? current?.trimestre ?? '').trim();
    const anneeScolaire = String(data.anneeScolaire ?? current?.anneeScolaire ?? '').trim();
    const typeEvaluation = String(data.typeEvaluation ?? current?.typeEvaluation ?? 'DEVOIR').trim().toUpperCase();
    const allowed = new Set(['DEVOIR', 'INTERROGATION', 'EXAMEN', 'COMPOSITION', 'CONTROLE', 'TP', 'ORAL']);

    if (!allowed.has(typeEvaluation)) {
      throw new BadRequestException(`Type d'évaluation invalide: ${typeEvaluation}`);
    }
    if (!eleveId || !matiereId || !trimestre || !anneeScolaire) {
      throw new BadRequestException('eleveId, matiereId, trimestre et anneeScolaire sont requis pour une note');
    }

    data.eleveId = eleveId;
    data.matiereId = matiereId;
    data.trimestre = trimestre;
    data.anneeScolaire = anneeScolaire;
    data.typeEvaluation = typeEvaluation;

    if (typeEvaluation === 'DEVOIR') {
      data.commentaire = data.commentaire !== undefined ? data.commentaire : current?.commentaire;
      data.commentaire = await this.resolveDevoirCommentaire(tenantId, data, currentNoteId, client);
      return;
    }

    if (typeEvaluation === 'COMPOSITION') {
      const duplicate = await client.note.findFirst({
        where: {
          tenantId,
          eleveId,
          matiereId,
          trimestre,
          anneeScolaire,
          typeEvaluation: 'COMPOSITION',
          ...(currentNoteId ? { id: { not: currentNoteId } } : {}),
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException('Une composition existe déjà pour cet élève, cette matière et cette période.');
      }
      data.commentaire = this.cleanCommentaire(data.commentaire !== undefined ? data.commentaire : current?.commentaire) || 'Composition';
    }
  }

  private async resolveDevoirCommentaire(
    tenantId: string,
    data: Record<string, any>,
    currentNoteId: string | undefined,
    client: Prisma.TransactionClient | PrismaService,
  ): Promise<string> {
    const existing = await client.note.findMany({
      where: {
        tenantId,
        eleveId: String(data.eleveId),
        matiereId: String(data.matiereId),
        trimestre: String(data.trimestre),
        anneeScolaire: String(data.anneeScolaire),
        typeEvaluation: 'DEVOIR',
        ...(currentNoteId ? { id: { not: currentNoteId } } : {}),
      },
      select: { commentaire: true, dateEvaluation: true, createdAt: true },
      orderBy: [{ dateEvaluation: 'asc' }, { createdAt: 'asc' }],
    });
    const occupied = this.occupiedDevoirSlots(existing);
    const requestedSlot = this.devoirSlot(data.commentaire);

    if (requestedSlot) {
      if (occupied.has(requestedSlot)) {
        throw new ConflictException(`Le Devoir ${requestedSlot} existe déjà pour cet élève, cette matière et cette période.`);
      }
      return `Devoir ${requestedSlot}`;
    }

    const nextSlot = this.nextDevoirSlot(occupied);
    if (!nextSlot) {
      throw new BadRequestException('Un élève ne peut pas avoir plus de 3 notes de devoir par matière et période.');
    }
    return `Devoir ${nextSlot}`;
  }

  private occupiedDevoirSlots(notes: Array<{ commentaire: string | null }>): Set<number> {
    const occupied = new Set<number>();
    const unlabeled = notes.filter((note) => !this.devoirSlot(note.commentaire));

    for (const note of notes) {
      const slot = this.devoirSlot(note.commentaire);
      if (slot) occupied.add(slot);
    }
    for (const _note of unlabeled) {
      const slot = this.nextDevoirSlot(occupied);
      if (slot) occupied.add(slot);
    }
    return occupied;
  }

  private devoirSlot(value: unknown): number | null {
    const normalized = String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
    const match = normalized.match(/^(?:devoir|dev|d)\s*([123])$/);
    return match ? Number(match[1]) : null;
  }

  private nextDevoirSlot(occupied: Set<number>): number | null {
    for (const slot of [1, 2, 3]) {
      if (!occupied.has(slot)) return slot;
    }
    return null;
  }

  private cleanCommentaire(value: unknown): string | null {
    const commentaire = String(value ?? '').trim();
    return commentaire || null;
  }
}
