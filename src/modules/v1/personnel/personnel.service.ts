import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { buildPageResult, PageResult, PaginationQueryDto } from '@/shared/dto/pagination-query.dto';
import { Prisma, StatutAbsencePersonnel, TypeAbsencePersonnel, TypeContrat, TypePointage } from '@prisma/client';
import { rethrowServiceError } from '@/common/utils/service-error.util';

export interface CreatePersonnelDto {
  utilisateurId: string;
  numeroMatricule?: string;
  typeContrat?: TypeContrat;
  dateEmbauche?: string;
  salaire?: number;
  soldeConge?: number;
}

export interface CreatePointageDto {
  personnelId: string;
  typePointage: TypePointage;
  dateHeure: string;
  methode?: string;
}

export interface CreateAbsencePersonnelDto {
  personnelId: string;
  dateDebut: string;
  dateFin: string;
  motif?: string;
  typeAbsence?: TypeAbsencePersonnel;
  justificatifUrl?: string;
}

@Injectable()
export class PersonnelService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreatePersonnelDto): Promise<unknown> {
    try {
      return await this.prisma.personnel.create({
        data: {
          tenantId,
          utilisateurId: dto.utilisateurId,
          numeroMatricule: dto.numeroMatricule,
          typeContrat: dto.typeContrat,
          dateEmbauche: dto.dateEmbauche ? new Date(dto.dateEmbauche) : undefined,
          salaire: dto.salaire,
          soldeConge: dto.soldeConge ?? 0,
        },
        include: { utilisateur: { select: { id: true, firstName: true, lastName: true, email: true, role: true } } },
      });
    } catch (error) {
      rethrowServiceError(error, 'creation personnel');
    }
  }

  async findAll(tenantId: string, query: PaginationQueryDto): Promise<PageResult<unknown>> {
    const skip = ((query.page ?? 1) - 1) * (query.size ?? 20);
    const where: Prisma.PersonnelWhereInput = {
      tenantId,
      ...(query.search
        ? {
            utilisateur: {
              OR: [
                { firstName: { contains: query.search, mode: 'insensitive' } },
                { lastName: { contains: query.search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.personnel.findMany({
        where,
        skip,
        take: query.size ?? 20,
        orderBy: { createdAt: 'desc' },
        include: { utilisateur: { select: { id: true, firstName: true, lastName: true, email: true, role: true } } },
      }),
      this.prisma.personnel.count({ where }),
    ]);

    return buildPageResult(data, total, query.page ?? 1, query.size ?? 20);
  }

  async findOne(tenantId: string, id: string): Promise<unknown> {
    const p = await this.prisma.personnel.findFirst({
      where: { id, tenantId },
      include: { utilisateur: true, pointages: { take: 10, orderBy: { dateHeure: 'desc' } } },
    });
    if (!p) throw new NotFoundException('Personnel introuvable');
    return p;
  }

  async update(tenantId: string, id: string, dto: Partial<CreatePersonnelDto>): Promise<unknown> {
    await this.findOne(tenantId, id);
    return this.prisma.personnel.update({
      where: { id },
      data: {
        ...(dto.numeroMatricule !== undefined ? { numeroMatricule: dto.numeroMatricule } : {}),
        ...(dto.typeContrat ? { typeContrat: dto.typeContrat } : {}),
        ...(dto.dateEmbauche ? { dateEmbauche: new Date(dto.dateEmbauche) } : {}),
        ...(dto.salaire !== undefined ? { salaire: dto.salaire } : {}),
        ...(dto.soldeConge !== undefined ? { soldeConge: dto.soldeConge } : {}),
      },
    });
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await this.findOne(tenantId, id);
    await this.prisma.personnel.delete({ where: { id } });
  }

  // Pointage
  async createPointage(tenantId: string, dto: CreatePointageDto, createdBy?: string): Promise<unknown> {
    try {
      return await this.prisma.pointage.create({
        data: {
          tenantId,
          personnelId: dto.personnelId,
          typePointage: dto.typePointage,
          dateHeure: new Date(dto.dateHeure),
          methode: dto.methode,
          createdBy,
        },
      });
    } catch (error) {
      rethrowServiceError(error, 'creation pointage');
    }
  }

  async findPointages(
    tenantId: string,
    query: PaginationQueryDto & { personnelId?: string; dateDebut?: string; dateFin?: string },
  ): Promise<PageResult<unknown>> {
    const skip = ((query.page ?? 1) - 1) * (query.size ?? 20);
    const where: Prisma.PointageWhereInput = {
      tenantId,
      ...(query.personnelId ? { personnelId: query.personnelId } : {}),
      ...(query.dateDebut || query.dateFin
        ? {
            dateHeure: {
              ...(query.dateDebut ? { gte: new Date(query.dateDebut) } : {}),
              ...(query.dateFin ? { lte: new Date(query.dateFin) } : {}),
            },
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.pointage.findMany({
        where,
        skip,
        take: query.size ?? 20,
        orderBy: { dateHeure: 'desc' },
        include: { personnel: { include: { utilisateur: { select: { firstName: true, lastName: true } } } } },
      }),
      this.prisma.pointage.count({ where }),
    ]);

    return buildPageResult(data, total, query.page ?? 1, query.size ?? 20);
  }

  // Absence Personnel
  async createAbsence(tenantId: string, dto: CreateAbsencePersonnelDto): Promise<unknown> {
    try {
      return await this.prisma.absencePersonnel.create({
        data: {
          tenantId,
          personnelId: dto.personnelId,
          dateDebut: new Date(dto.dateDebut),
          dateFin: new Date(dto.dateFin),
          motif: dto.motif,
          typeAbsence: dto.typeAbsence,
          statut: StatutAbsencePersonnel.EN_ATTENTE,
        },
      });
    } catch (error) {
      rethrowServiceError(error, 'creation absence personnel');
    }
  }

  async findAbsences(tenantId: string, query: PaginationQueryDto & { personnelId?: string }): Promise<PageResult<unknown>> {
    const skip = ((query.page ?? 1) - 1) * (query.size ?? 20);
    const where: Prisma.AbsencePersonnelWhereInput = {
      tenantId,
      ...(query.personnelId ? { personnelId: query.personnelId } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.absencePersonnel.findMany({
        where,
        skip,
        take: query.size ?? 20,
        orderBy: { dateDebut: 'desc' },
        include: { personnel: { include: { utilisateur: { select: { firstName: true, lastName: true } } } } },
      }),
      this.prisma.absencePersonnel.count({ where }),
    ]);

    return buildPageResult(data, total, query.page ?? 1, query.size ?? 20);
  }

  async validerAbsence(tenantId: string, id: string, validePar: string): Promise<unknown> {
    const a = await this.prisma.absencePersonnel.findFirst({ where: { id, tenantId } });
    if (!a) throw new NotFoundException('Absence introuvable');
    return this.prisma.absencePersonnel.update({
      where: { id },
      data: { statut: StatutAbsencePersonnel.APPROUVEE, validePar },
    });
  }
}
