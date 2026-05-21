import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { CreateClasseDto } from './dto/create-classe.dto';
import { UpdateClasseDto } from './dto/update-classe.dto';

const PROF_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  specialite: true,
  photoUrl: true,
};

const CLASSE_INCLUDE = {
  niveau: {
    select: {
      id: true,
      code: true,
      libelle: true,
      ordre: true,
      cycle: { select: { id: true, code: true, libelle: true } },
    },
  },
  anneeAcademique: { select: { id: true, libelle: true, estCourante: true } },
  professeurResponsable: { select: PROF_SELECT },
  stagiaires: {
    include: { stagiaire: { select: PROF_SELECT } },
    orderBy: { createdAt: 'asc' as const },
  },
  _count: { select: { eleves: true } },
};

@Injectable()
export class ClasseService {
  constructor(private readonly prisma: PrismaService) {}

  // ----------------------------------------------------------------
  // List
  // ----------------------------------------------------------------

  async getClasses(tenantId: string, anneeId?: string, niveauId?: string, cycleId?: string) {
    await this.assertTenantExists(tenantId);
    await this.syncClassActivityForCurrentYear(tenantId);

    // Default to current year if no anneeId provided
    let resolvedAnneeId = anneeId;
    if (!resolvedAnneeId) {
      const courante = await this.prisma.anneeAcademique.findFirst({
        where: { tenantId, estCourante: true },
        select: { id: true },
      });
      resolvedAnneeId = courante?.id;
    }

    const where: Record<string, unknown> = { tenantId, actif: true };
    if (resolvedAnneeId) where.anneeAcademiqueId = resolvedAnneeId;
    if (niveauId) where.niveauId = niveauId;
    if (cycleId) {
      where.niveau = { cycleId };
    }

    const classes = await this.prisma.classe.findMany({
      where,
      include: CLASSE_INCLUDE,
      orderBy: [{ niveau: { ordre: 'asc' } }, { nom: 'asc' }],
    });

    return classes.map(this.toResponse);
  }

  // ----------------------------------------------------------------
  // Create
  // ----------------------------------------------------------------

  async createClasse(tenantId: string, dto: CreateClasseDto) {
    await this.assertTenantExists(tenantId);

    const niveau = await this.prisma.niveau.findFirst({ where: { id: dto.niveauId, tenantId } });
    if (!niveau) throw new NotFoundException('Niveau introuvable');

    const annee = await this.prisma.anneeAcademique.findFirst({ where: { id: dto.anneeAcademiqueId, tenantId } });
    if (!annee) throw new NotFoundException('Année académique introuvable');

    const existing = await this.prisma.classe.findFirst({
      where: { tenantId, nom: dto.nom.trim(), anneeAcademiqueId: dto.anneeAcademiqueId },
    });
    if (existing) throw new ConflictException('Une classe avec ce nom existe déjà pour cette année');

    if (dto.professeurResponsableId) {
      const prof = await this.prisma.user.findFirst({
        where: { id: dto.professeurResponsableId, tenantId, role: 'ENSEIGNANT' },
      });
      if (!prof) throw new NotFoundException('Enseignant introuvable');
    }

    const classe = await this.prisma.classe.create({
      data: {
        tenantId,
        nom: dto.nom.trim(),
        niveauId: dto.niveauId,
        anneeAcademiqueId: dto.anneeAcademiqueId,
        professeurResponsableId: dto.professeurResponsableId ?? null,
        effectifMax: dto.effectifMax ?? null,
        actif: Boolean(annee.estCourante && annee.actif),
      },
      include: CLASSE_INCLUDE,
    });

    return this.toResponse(classe);
  }

  // ----------------------------------------------------------------
  // Get one
  // ----------------------------------------------------------------

  async getClasse(tenantId: string, id: string) {
    const classe = await this.prisma.classe.findFirst({
      where: { id, tenantId },
      include: CLASSE_INCLUDE,
    });
    if (!classe) throw new NotFoundException('Classe introuvable');
    return this.toResponse(classe);
  }

  // ----------------------------------------------------------------
  // Update
  // ----------------------------------------------------------------

  async updateClasse(tenantId: string, id: string, dto: UpdateClasseDto) {
    const existing = await this.prisma.classe.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Classe introuvable');

    if (dto.niveauId) {
      const niveau = await this.prisma.niveau.findFirst({ where: { id: dto.niveauId, tenantId } });
      if (!niveau) throw new NotFoundException('Niveau introuvable');
    }

    if (dto.professeurResponsableId) {
      const prof = await this.prisma.user.findFirst({
        where: { id: dto.professeurResponsableId, tenantId, role: 'ENSEIGNANT' },
      });
      if (!prof) throw new NotFoundException('Enseignant introuvable');
    }

    const updated = await this.prisma.classe.update({
      where: { id },
      data: {
        ...(dto.nom ? { nom: dto.nom.trim() } : {}),
        ...(dto.niveauId ? { niveauId: dto.niveauId } : {}),
        ...(dto.professeurResponsableId !== undefined
          ? { professeurResponsableId: dto.professeurResponsableId }
          : {}),
        ...(dto.effectifMax !== undefined ? { effectifMax: dto.effectifMax } : {}),
      },
      include: CLASSE_INCLUDE,
    });

    return this.toResponse(updated);
  }

  // ----------------------------------------------------------------
  // Delete
  // ----------------------------------------------------------------

  async deleteClasse(tenantId: string, id: string) {
    const existing = await this.prisma.classe.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Classe introuvable');

    const nbEleves = await this.prisma.user.count({ where: { classeId: id, tenantId } });
    if (nbEleves > 0) {
      throw new BadRequestException(`Impossible de supprimer : ${nbEleves} élève(s) rattaché(s) à cette classe`);
    }

    await this.prisma.classe.delete({ where: { id } });
  }

  // ----------------------------------------------------------------
  // Duplication annuelle
  // ----------------------------------------------------------------

  async duplicateClassesForYear(tenantId: string, targetAnneeId: string, sourceAnneeId?: string) {
    await this.assertTenantExists(tenantId);

    const targetAnnee = await this.prisma.anneeAcademique.findFirst({
      where: { id: targetAnneeId, tenantId },
      select: { id: true, libelle: true, dateDebut: true },
    });
    if (!targetAnnee) throw new NotFoundException('Année cible introuvable');

    const alreadyDuplicated = await this.prisma.anneeAcademique.findFirst({
      where: { id: targetAnneeId, tenantId, classesDupliquees: true },
      select: { libelle: true },
    });
    if (alreadyDuplicated) {
      await this.prisma.classe.updateMany({
        where: { tenantId, anneeAcademiqueId: { not: targetAnneeId } },
        data: { actif: false },
      });
      await this.prisma.classe.updateMany({
        where: { tenantId, anneeAcademiqueId: targetAnneeId },
        data: { actif: true },
      });
      return { created: 0, skipped: 0, sourceAnnee: '', targetAnnee: alreadyDuplicated.libelle, alreadyDuplicated: true };
    }

    const sourceAnnee = sourceAnneeId
      ? await this.prisma.anneeAcademique.findFirst({
          where: { id: sourceAnneeId, tenantId },
          select: { id: true, libelle: true },
        })
      : await this.prisma.anneeAcademique.findFirst({
          where: { tenantId, id: { not: targetAnneeId }, dateDebut: { lt: targetAnnee.dateDebut } },
          orderBy: { dateDebut: 'desc' },
          select: { id: true, libelle: true },
        });

    if (!sourceAnnee) throw new NotFoundException('Année source introuvable');

    const sourceClasses = await this.prisma.classe.findMany({
      where: { tenantId, anneeAcademiqueId: sourceAnnee.id },
      select: {
        nom: true,
        niveauId: true,
        effectifMax: true,
        professeurResponsableId: true,
      },
      orderBy: { nom: 'asc' },
    });

    let created = 0;
    let skipped = 0;

    for (const classe of sourceClasses) {
      const existing = await this.prisma.classe.findFirst({
        where: { tenantId, nom: classe.nom, anneeAcademiqueId: targetAnnee.id },
        select: { id: true },
      });

      if (existing) {
        skipped++;
        continue;
      }

      await this.prisma.classe.create({
        data: {
          tenantId,
          nom: classe.nom,
          niveauId: classe.niveauId,
          anneeAcademiqueId: targetAnnee.id,
          effectifMax: classe.effectifMax,
          professeurResponsableId: classe.professeurResponsableId,
          actif: true,
        },
      });
      created++;
    }

    await this.prisma.classe.updateMany({
      where: { tenantId, anneeAcademiqueId: sourceAnnee.id },
      data: { actif: false },
    });
    await this.prisma.anneeAcademique.update({
      where: { id: targetAnnee.id },
      data: { classesDupliquees: true },
    });

    return {
      created,
      skipped,
      sourceAnnee: sourceAnnee.libelle,
      targetAnnee: targetAnnee.libelle,
      alreadyDuplicated: false,
    };
  }

  // ----------------------------------------------------------------
  // Stagiaires
  // ----------------------------------------------------------------

  async addStagiaire(tenantId: string, classeId: string, stagiaireId: string) {
    const classe = await this.prisma.classe.findFirst({ where: { id: classeId, tenantId } });
    if (!classe) throw new NotFoundException('Classe introuvable');

    const stagiaire = await this.prisma.user.findFirst({
      where: { id: stagiaireId, tenantId, role: 'ENSEIGNANT' },
    });
    if (!stagiaire) throw new NotFoundException('Enseignant introuvable');

    const existing = await this.prisma.classeStagiaire.findUnique({
      where: { classeId_stagiaireId: { classeId, stagiaireId } },
    });
    if (existing) throw new ConflictException('Ce stagiaire est déjà rattaché à cette classe');

    await this.prisma.classeStagiaire.create({
      data: { tenantId, classeId, stagiaireId },
    });

    return this.getClasse(tenantId, classeId);
  }

  async removeStagiaire(tenantId: string, classeId: string, stagiaireId: string) {
    const entry = await this.prisma.classeStagiaire.findUnique({
      where: { classeId_stagiaireId: { classeId, stagiaireId } },
    });
    if (!entry) throw new NotFoundException('Stagiaire non rattaché à cette classe');

    await this.prisma.classeStagiaire.delete({
      where: { classeId_stagiaireId: { classeId, stagiaireId } },
    });

    return this.getClasse(tenantId, classeId);
  }

  // ----------------------------------------------------------------
  // Enseignants dropdown
  // ----------------------------------------------------------------

  async getEnseignants(tenantId: string) {
    await this.assertTenantExists(tenantId);
    return this.prisma.user.findMany({
      where: { tenantId, role: 'ENSEIGNANT', actif: true },
      select: { id: true, firstName: true, lastName: true, email: true, specialite: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  // ----------------------------------------------------------------
  // Utils
  // ----------------------------------------------------------------

  private async assertTenantExists(tenantId: string): Promise<void> {
    const exists = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Tenant introuvable');
  }

  private async syncClassActivityForCurrentYear(tenantId: string): Promise<void> {
    const current = await this.prisma.anneeAcademique.findFirst({
      where: { tenantId, estCourante: true, actif: true },
      select: { id: true },
    });
    if (!current) return;

    await this.prisma.classe.updateMany({
      where: { tenantId, anneeAcademiqueId: { not: current.id }, actif: true },
      data: { actif: false },
    });
    await this.prisma.classe.updateMany({
      where: { tenantId, anneeAcademiqueId: current.id, actif: false },
      data: { actif: true },
    });
  }

  private toResponse(classe: any) {
    const cycleCode = classe.niveau?.cycle?.code ?? '';
    const isUnifiedSection = ['MATERNELLE', 'PRIMAIRE', 'CRECHE'].includes(cycleCode.toUpperCase());

    return {
      id: classe.id,
      nom: classe.nom,
      effectifMax: classe.effectifMax,
      anneeAcademique: classe.anneeAcademique
        ? { id: classe.anneeAcademique.id, libelle: classe.anneeAcademique.libelle, courante: classe.anneeAcademique.estCourante }
        : null,
      niveau: classe.niveau
        ? {
            id: classe.niveau.id,
            code: classe.niveau.code,
            nom: classe.niveau.libelle,
            ordre: classe.niveau.ordre,
            cycle: classe.niveau.cycle
              ? { id: classe.niveau.cycle.id, code: classe.niveau.cycle.code, nom: classe.niveau.cycle.libelle }
              : null,
          }
        : null,
      professeurResponsable: classe.professeurResponsable
        ? {
            id: classe.professeurResponsable.id,
            nom: `${classe.professeurResponsable.firstName} ${classe.professeurResponsable.lastName}`,
            email: classe.professeurResponsable.email,
            specialite: classe.professeurResponsable.specialite,
            photoUrl: classe.professeurResponsable.photoUrl,
          }
        : null,
      stagiaires: (classe.stagiaires ?? []).map((s: any) => ({
        id: s.stagiaire.id,
        nom: `${s.stagiaire.firstName} ${s.stagiaire.lastName}`,
        email: s.stagiaire.email,
        specialite: s.stagiaire.specialite,
        photoUrl: s.stagiaire.photoUrl,
      })),
      nbEleves: classe._count?.eleves ?? 0,
      actif: classe.actif,
      isUnifiedSection,
      createdAt: classe.createdAt,
    };
  }
}
