import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import {
  CreateAnneeDto,
  CreateBatimentDto,
  CreateClasseDto,
  CreateCycleDto,
  CreateNiveauDto,
  CreateSalleDto,
} from '@/modules/school/dto/school.dto';
import { rethrowServiceError } from '@/common/utils/service-error.util';

@Injectable()
export class SchoolService {
  constructor(private readonly prisma: PrismaService) {}

  listUsers(tenantId: string) { return this.prisma.user.findMany({ where: { tenantId } }); }
  listTeachers(tenantId: string) { return this.prisma.user.findMany({ where: { tenantId, role: 'ENSEIGNANT' } }); }
  listStudents(tenantId: string) { return this.prisma.user.findMany({ where: { tenantId, role: 'ELEVE' } }); }
  listParents(tenantId: string) { return this.prisma.user.findMany({ where: { tenantId, role: 'PARENT' } }); }

  listCycles(tenantId: string) { return this.prisma.cycle.findMany({ where: { tenantId } }); }
  async createCycle(tenantId: string, dto: CreateCycleDto) {
    try {
      return await this.prisma.cycle.create({ data: { ...dto, tenantId } });
    } catch (error) {
      rethrowServiceError(error, 'création cycle');
    }
  }

  listNiveaux(tenantId: string) { return this.prisma.niveau.findMany({ where: { tenantId } }); }
  async createNiveau(tenantId: string, dto: CreateNiveauDto) {
    try {
      return await this.prisma.niveau.create({ data: { ...dto, tenantId } });
    } catch (error) {
      rethrowServiceError(error, 'création niveau');
    }
  }

  listBatiments(tenantId: string) { return this.prisma.batiment.findMany({ where: { tenantId } }); }
  async createBatiment(tenantId: string, dto: CreateBatimentDto) {
    try {
      return await this.prisma.batiment.create({ data: { ...dto, tenantId } });
    } catch (error) {
      rethrowServiceError(error, 'création bâtiment');
    }
  }

  listSalles(tenantId: string) { return this.prisma.salle.findMany({ where: { tenantId } }); }
  async createSalle(tenantId: string, dto: CreateSalleDto) {
    try {
      return await this.prisma.salle.create({ data: { ...dto, tenantId } });
    } catch (error) {
      rethrowServiceError(error, 'création salle');
    }
  }

  listAnnees(tenantId: string) { return this.prisma.anneeAcademique.findMany({ where: { tenantId } }); }
  async createAnnee(tenantId: string, dto: CreateAnneeDto) {
    try {
      return await this.prisma.anneeAcademique.create({
        data: {
          tenantId,
          libelle: dto.libelle,
          dateDebut: new Date(dto.dateDebut),
          dateFin: new Date(dto.dateFin),
        },
      });
    } catch (error) {
      rethrowServiceError(error, 'création année académique');
    }
  }

  listClasses(tenantId: string) {
    return this.prisma.classe.findMany({ where: { tenantId } });
  }
  async createClasse(tenantId: string, dto: CreateClasseDto) {
    try {
      const niveauId = String(dto.niveauId ?? '').trim() || null;
      const cycleId = String(dto.cycleId ?? '').trim() || null;
      if (niveauId) {
        const niveau = await this.prisma.niveau.findFirst({
          where: { id: niveauId, tenantId },
          select: { id: true, cycleId: true },
        });
        if (!niveau) throw new NotFoundException('Niveau introuvable');
        const { cycleId: _cycleId, ...classeDto } = dto;
        return await this.prisma.classe.create({ data: { ...classeDto, tenantId, niveauId } });
      }

      if (!cycleId) throw new BadRequestException('Le cycle est obligatoire lorsque le niveau n’est pas renseigné');
      const cycle = await this.prisma.cycle.findFirst({
        where: { id: cycleId, tenantId },
        select: { id: true, code: true },
      });
      if (!cycle) throw new NotFoundException('Cycle introuvable');
      if (cycle.code.toUpperCase() !== 'PRIMAIRE') {
        throw new BadRequestException('Le niveau est obligatoire pour ce cycle');
      }

      const { cycleId: _cycleId, ...classeDto } = dto;
      return await this.prisma.classe.create({ data: { ...classeDto, tenantId, niveauId: null } });
    } catch (error) {
      rethrowServiceError(error, 'création classe');
    }
  }

  async etabStats(tenantId: string) {
    const [eleves, enseignants, classes, salles] = await Promise.all([
      this.prisma.user.count({ where: { tenantId, role: 'ELEVE' } }),
      this.prisma.user.count({ where: { tenantId, role: 'ENSEIGNANT' } }),
      this.prisma.classe.count({ where: { tenantId } }),
      this.prisma.salle.count({ where: { tenantId } }),
    ]);
    return { eleves, enseignants, classes, salles };
  }
}
