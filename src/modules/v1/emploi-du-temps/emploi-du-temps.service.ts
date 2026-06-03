import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { Prisma } from '@prisma/client';

export interface CreateEmploiDuTempsDto {
  classeId: string;
  coursId?: string | null;
  salleId?: string | null;
  enseignantId?: string | null;
  matiereId?: string | null;
  jourSemaine: string;
  heureDebut: string;
  heureFin: string;
  anneeScolaire?: string | null;
  dateDebutValidite?: string | null;
  dateFinValidite?: string | null;
  publie?: boolean;
}

@Injectable()
export class EmploiDuTempsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateEmploiDuTempsDto): Promise<unknown> {
    const resolved = await this.resolveCourseFields(tenantId, dto);
    const created = await this.prisma.emploiDuTemps.create({
      data: {
        tenantId,
        classeId: dto.classeId,
        coursId: dto.coursId ?? null,
        salleId: dto.salleId ?? null,
        enseignantId: resolved.enseignantId ?? null,
        matiereId: resolved.matiereId ?? null,
        jourSemaine: dto.jourSemaine,
        heureDebut: dto.heureDebut,
        heureFin: dto.heureFin,
        anneeScolaire: dto.anneeScolaire ?? null,
        dateDebutValidite: dto.dateDebutValidite ? new Date(dto.dateDebutValidite) : null,
        dateFinValidite: dto.dateFinValidite ? new Date(dto.dateFinValidite) : null,
        publie: dto.publie ?? false,
      },
    });

    return this.findOne(tenantId, created.id);
  }

  async findByClasse(tenantId: string, classeId: string, anneeScolaire?: string): Promise<unknown[]> {
    const rows = await this.prisma.emploiDuTemps.findMany({
      where: {
        tenantId,
        classeId,
        ...(anneeScolaire ? { anneeScolaire } : {}),
      },
      orderBy: [{ jourSemaine: 'asc' }, { heureDebut: 'asc' }],
      include: this.readInclude(),
    });

    return this.toResponses(rows);
  }

  async findAll(tenantId: string, classeId?: string, enseignantId?: string): Promise<unknown[]> {
    const where: Prisma.EmploiDuTempsWhereInput = {
      tenantId,
      ...(classeId ? { classeId } : {}),
      ...(enseignantId ? { enseignantId } : {}),
    };

    const rows = await this.prisma.emploiDuTemps.findMany({
      where,
      orderBy: [{ classeId: 'asc' }, { jourSemaine: 'asc' }, { heureDebut: 'asc' }],
      include: this.readInclude(),
    });

    return this.toResponses(rows);
  }

  async findOne(tenantId: string, id: string): Promise<unknown> {
    const e = await this.prisma.emploiDuTemps.findFirst({
      where: { id, tenantId },
      include: this.readInclude(),
    });
    if (!e) throw new NotFoundException('Emploi du temps introuvable');
    const [response] = await this.toResponses([e]);
    return response;
  }

  async update(tenantId: string, id: string, dto: Partial<CreateEmploiDuTempsDto>): Promise<unknown> {
    await this.findOne(tenantId, id);
    const resolved = await this.resolveCourseFields(tenantId, dto);
    await this.prisma.emploiDuTemps.update({
      where: { id },
      data: this.buildUpdateData(dto, resolved),
    });

    return this.findOne(tenantId, id);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await this.findOne(tenantId, id);
    await this.prisma.emploiDuTemps.delete({ where: { id } });
  }

  async publier(tenantId: string, classeId: string, anneeScolaire: string): Promise<void> {
    await this.prisma.emploiDuTemps.updateMany({
      where: { tenantId, classeId, anneeScolaire },
      data: { publie: true },
    });
  }

  private readInclude() {
    return {
      classe: { select: { id: true, nom: true } },
      cours: { include: { matiere: true } },
      salle: { include: { batiment: { select: { id: true, nom: true } } } },
    } satisfies Prisma.EmploiDuTempsInclude;
  }

  private async resolveCourseFields(
    tenantId: string,
    dto: Partial<CreateEmploiDuTempsDto>,
  ): Promise<{ matiereId?: string | null; enseignantId?: string | null }> {
    if (!dto.coursId) {
      return {
        matiereId: dto.matiereId,
        enseignantId: dto.enseignantId,
      };
    }

    const cours = await this.prisma.cours.findFirst({
      where: { id: dto.coursId, tenantId },
      select: { matiereId: true, enseignantId: true },
    });

    return {
      matiereId: dto.matiereId ?? cours?.matiereId ?? null,
      enseignantId: dto.enseignantId ?? cours?.enseignantId ?? null,
    };
  }

  private buildUpdateData(
    dto: Partial<CreateEmploiDuTempsDto>,
    resolved: { matiereId?: string | null; enseignantId?: string | null },
  ): Prisma.EmploiDuTempsUncheckedUpdateInput {
    const data: Prisma.EmploiDuTempsUncheckedUpdateInput = {};

    if (dto.classeId !== undefined) data.classeId = dto.classeId;
    if (dto.coursId !== undefined) data.coursId = dto.coursId || null;
    if (dto.salleId !== undefined) data.salleId = dto.salleId || null;
    if (resolved.enseignantId !== undefined) data.enseignantId = resolved.enseignantId || null;
    if (resolved.matiereId !== undefined) data.matiereId = resolved.matiereId || null;
    if (dto.jourSemaine !== undefined) data.jourSemaine = dto.jourSemaine;
    if (dto.heureDebut !== undefined) data.heureDebut = dto.heureDebut;
    if (dto.heureFin !== undefined) data.heureFin = dto.heureFin;
    if (dto.anneeScolaire !== undefined) data.anneeScolaire = dto.anneeScolaire || null;
    if (dto.dateDebutValidite !== undefined) {
      data.dateDebutValidite = dto.dateDebutValidite ? new Date(dto.dateDebutValidite) : null;
    }
    if (dto.dateFinValidite !== undefined) {
      data.dateFinValidite = dto.dateFinValidite ? new Date(dto.dateFinValidite) : null;
    }
    if (dto.publie !== undefined) data.publie = dto.publie;

    return data;
  }

  private async toResponses(rows: Array<Prisma.EmploiDuTempsGetPayload<{ include: ReturnType<EmploiDuTempsService['readInclude']> }>>) {
    const matiereIds = [...new Set(rows.map((row) => row.matiereId ?? row.cours?.matiereId).filter(Boolean))] as string[];
    const enseignantIds = [...new Set(rows.map((row) => row.enseignantId ?? row.cours?.enseignantId).filter(Boolean))] as string[];

    const [matieres, enseignants] = await Promise.all([
      matiereIds.length
        ? this.prisma.matiere.findMany({
            where: { id: { in: matiereIds } },
            select: { id: true, code: true, libelle: true },
          })
        : [],
      enseignantIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: enseignantIds } },
            select: { id: true, firstName: true, lastName: true },
          })
        : [],
    ]);

    const matiereById = new Map(matieres.map((matiere) => [matiere.id, matiere]));
    const enseignantById = new Map(enseignants.map((enseignant) => [enseignant.id, enseignant]));

    return rows.map((row) => {
      const matiereId = row.matiereId ?? row.cours?.matiereId ?? null;
      const enseignantId = row.enseignantId ?? row.cours?.enseignantId ?? null;
      const matiere = matiereId ? matiereById.get(matiereId) ?? row.cours?.matiere ?? null : null;
      const enseignant = enseignantId ? enseignantById.get(enseignantId) ?? null : null;

      return {
        id: row.id,
        classeId: row.classeId,
        classeNom: row.classe?.nom ?? '',
        coursId: row.coursId,
        matiereId,
        matiereLibelle: matiere?.libelle ?? null,
        matiereCode: matiere?.code ?? null,
        enseignantId,
        enseignantNom: enseignant ? `${enseignant.firstName ?? ''} ${enseignant.lastName ?? ''}`.trim() : null,
        salleId: row.salleId,
        salleNom: row.salle?.nom ?? null,
        salleBatimentNom: row.salle?.batiment?.nom ?? null,
        jourSemaine: row.jourSemaine,
        heureDebut: row.heureDebut,
        heureFin: row.heureFin,
        anneeScolaire: row.anneeScolaire,
        dateDebutValidite: row.dateDebutValidite,
        dateFinValidite: row.dateFinValidite,
        publie: row.publie,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }
}
