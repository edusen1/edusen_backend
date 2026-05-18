import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { Prisma } from '@prisma/client';

export interface CreateEmploiDuTempsDto {
  classeId: string;
  coursId?: string;
  salleId?: string;
  enseignantId?: string;
  matiereId?: string;
  jourSemaine: string;
  heureDebut: string;
  heureFin: string;
  anneeScolaire?: string;
  dateDebutValidite?: string;
  dateFinValidite?: string;
  publie?: boolean;
}

@Injectable()
export class EmploiDuTempsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateEmploiDuTempsDto): Promise<unknown> {
    return this.prisma.emploiDuTemps.create({
      data: {
        tenantId,
        classeId: dto.classeId,
        coursId: dto.coursId,
        salleId: dto.salleId,
        enseignantId: dto.enseignantId,
        matiereId: dto.matiereId,
        jourSemaine: dto.jourSemaine,
        heureDebut: dto.heureDebut,
        heureFin: dto.heureFin,
        anneeScolaire: dto.anneeScolaire,
        dateDebutValidite: dto.dateDebutValidite ? new Date(dto.dateDebutValidite) : undefined,
        dateFinValidite: dto.dateFinValidite ? new Date(dto.dateFinValidite) : undefined,
        publie: dto.publie ?? false,
      },
      include: {
        classe: { select: { id: true, nom: true } },
        cours: { include: { matiere: true } },
        salle: { select: { id: true, nom: true } },
      },
    });
  }

  async findByClasse(tenantId: string, classeId: string, anneeScolaire?: string): Promise<unknown[]> {
    return this.prisma.emploiDuTemps.findMany({
      where: {
        tenantId,
        classeId,
        ...(anneeScolaire ? { anneeScolaire } : {}),
        publie: true,
      },
      orderBy: [{ jourSemaine: 'asc' }, { heureDebut: 'asc' }],
      include: {
        cours: { include: { matiere: true } },
        salle: { select: { id: true, nom: true } },
      },
    });
  }

  async findAll(tenantId: string, classeId?: string, enseignantId?: string): Promise<unknown[]> {
    const where: Prisma.EmploiDuTempsWhereInput = {
      tenantId,
      ...(classeId ? { classeId } : {}),
      ...(enseignantId ? { enseignantId } : {}),
    };

    return this.prisma.emploiDuTemps.findMany({
      where,
      orderBy: [{ classeId: 'asc' }, { jourSemaine: 'asc' }, { heureDebut: 'asc' }],
      include: { classe: { select: { id: true, nom: true } }, cours: { include: { matiere: true } } },
    });
  }

  async findOne(tenantId: string, id: string): Promise<unknown> {
    const e = await this.prisma.emploiDuTemps.findFirst({
      where: { id, tenantId },
      include: {
        classe: true,
        cours: { include: { matiere: true } },
        salle: true,
      },
    });
    if (!e) throw new NotFoundException('Emploi du temps introuvable');
    return e;
  }

  async update(tenantId: string, id: string, dto: Partial<CreateEmploiDuTempsDto>): Promise<unknown> {
    await this.findOne(tenantId, id);
    return this.prisma.emploiDuTemps.update({
      where: { id },
      data: {
        ...dto,
        dateDebutValidite: dto.dateDebutValidite ? new Date(dto.dateDebutValidite) : undefined,
        dateFinValidite: dto.dateFinValidite ? new Date(dto.dateFinValidite) : undefined,
      },
    });
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
}
