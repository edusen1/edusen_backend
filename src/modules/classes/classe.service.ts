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
  anneeAcademique: { select: { id: true, libelle: true, estCourante: true, actif: true } },
  professeurResponsable: { select: PROF_SELECT },
  stagiaires: {
    include: { stagiaire: { select: PROF_SELECT } },
    orderBy: [{ actif: 'desc' as const }, { dateDebut: 'desc' as const }],
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
        where: { tenantId, actif: true },
        orderBy: { dateDebut: 'desc' },
        select: { id: true },
      });
      resolvedAnneeId = courante?.id;
    }

    const where: Record<string, unknown> = { tenantId };
    if (!anneeId) where.actif = true;
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
        actif: Boolean(annee.actif),
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

  async getClasseEleves(tenantId: string, classeId: string) {
    const classe = await this.prisma.classe.findFirst({
      where: { id: classeId, tenantId },
      select: { id: true, anneeAcademiqueId: true },
    });
    if (!classe) throw new NotFoundException('Classe introuvable');

    const inscriptions = await this.prisma.inscription.findMany({
      where: {
        tenantId,
        classeId,
        ...(classe.anneeAcademiqueId ? { anneeAcademiqueId: classe.anneeAcademiqueId } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });

    const eleves = await this.prisma.user.findMany({
      where: { tenantId, id: { in: inscriptions.map((inscription) => inscription.eleveId) }, role: 'ELEVE' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        telephone: true,
        matricule: true,
        photoUrl: true,
        genre: true,
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    const eleveById = new Map(eleves.map((eleve) => [eleve.id, eleve]));

    return inscriptions.map((inscription) => {
      const eleve = eleveById.get(inscription.eleveId);
      return ({
      inscriptionId: inscription.id,
      statut: inscription.statut,
      eleve: eleve
        ? {
            id: eleve.id,
            nom: `${eleve.firstName ?? ''} ${eleve.lastName ?? ''}`.trim(),
            firstName: eleve.firstName,
            lastName: eleve.lastName,
            email: eleve.email,
            telephone: eleve.telephone,
            matricule: eleve.matricule,
            photoUrl: eleve.photoUrl,
            genre: eleve.genre,
          }
        : null,
      });
    });
  }

  async getEleveNotesForClasse(tenantId: string, classeId: string, eleveId: string) {
    const classe = await this.prisma.classe.findFirst({
      where: { id: classeId, tenantId },
      include: {
        niveau: { include: { cycle: true } },
        anneeAcademique: true,
      },
    });
    if (!classe) throw new NotFoundException('Classe introuvable');

    const inscription = await this.prisma.inscription.findFirst({
      where: {
        tenantId,
        classeId,
        eleveId,
        ...(classe.anneeAcademiqueId ? { anneeAcademiqueId: classe.anneeAcademiqueId } : {}),
      },
    });
    if (!inscription) throw new NotFoundException('Élève introuvable dans cette classe');

    const eleve = await this.prisma.user.findFirst({
      where: { id: eleveId, tenantId, role: 'ELEVE' },
      select: { id: true, firstName: true, lastName: true, email: true, matricule: true, photoUrl: true },
    });
    if (!eleve) throw new NotFoundException('Élève introuvable');

    const cycleCode = classe.niveau?.cycle?.code?.toUpperCase() ?? '';
    const periods = ['MATERNELLE', 'PRIMAIRE', 'CRECHE'].includes(cycleCode)
      ? ['SEMESTRE_1', 'SEMESTRE_2', 'SEMESTRE_3']
      : ['SEMESTRE_1', 'SEMESTRE_2'];
    const anneeScolaire = classe.anneeAcademique?.libelle ?? '';

    const [cours, matiereClasses, notes] = await Promise.all([
      this.prisma.cours.findMany({
        where: { tenantId, classeId, ...(classe.anneeAcademiqueId ? { anneeAcademiqueId: classe.anneeAcademiqueId } : {}) },
        include: {
          matiere: true,
        },
        orderBy: { matiere: { libelle: 'asc' } },
      }),
      this.prisma.matiereClasse.findMany({
        where: { tenantId, classeId, ...(classe.anneeAcademiqueId ? { anneeAcademiqueId: classe.anneeAcademiqueId } : {}) },
        include: {
          matiere: true,
          enseignant: { select: PROF_SELECT },
        },
        orderBy: { matiere: { libelle: 'asc' } },
      }),
      this.prisma.note.findMany({
        where: { tenantId, eleveId, anneeScolaire },
        include: { matiere: true },
        orderBy: [{ trimestre: 'asc' }, { matiere: { libelle: 'asc' } }, { dateEvaluation: 'asc' }],
      }),
    ]);

    const subjectsById = new Map<string, any>();
    for (const row of cours as any[]) {
      subjectsById.set(row.matiereId, {
        matiereId: row.matiereId,
        libelle: row.matiere.libelle,
        code: row.matiere.code,
        coefficient: row.coefficient ?? row.matiere.coefficient ?? 1,
        enseignant: null,
      });
    }
    for (const row of matiereClasses) {
      if (!subjectsById.has(row.matiereId)) {
        subjectsById.set(row.matiereId, {
          matiereId: row.matiereId,
          libelle: row.matiere.libelle,
          code: row.matiere.code,
          coefficient: row.matiere.coefficient ?? 1,
          enseignant: row.enseignant,
        });
      }
    }
    for (const note of notes) {
      if (!subjectsById.has(note.matiereId)) {
        subjectsById.set(note.matiereId, {
          matiereId: note.matiereId,
          libelle: note.matiere.libelle,
          code: note.matiere.code,
          coefficient: note.matiere.coefficient ?? 1,
          enseignant: null,
        });
      }
    }

    const normalize = (note: any) => Number((((note.note ?? 0) / (note.noteSur || 20)) * 20).toFixed(2));
    const average = (values: number[]) => values.length
      ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2))
      : null;
    const weightedAverage = (rows: { moyenne: number | null; coefficient: number }[]) => {
      const valid = rows.filter((row) => row.moyenne !== null);
      const totalCoeff = valid.reduce((sum, row) => sum + row.coefficient, 0);
      if (!valid.length || totalCoeff <= 0) return null;
      return Number((valid.reduce((sum, row) => sum + Number(row.moyenne) * row.coefficient, 0) / totalCoeff).toFixed(2));
    };

    const periodes = periods.map((periode) => {
      const subjects = [...subjectsById.values()].map((subject) => {
        const subjectNotes = notes.filter((note) => note.trimestre === periode && note.matiereId === subject.matiereId);
        const devoirs = subjectNotes.filter((note) => note.typeEvaluation !== 'COMPOSITION').map(normalize);
        const compositions = subjectNotes.filter((note) => note.typeEvaluation === 'COMPOSITION').map(normalize);
        const moyenneDevoirs = average(devoirs);
        const composition = average(compositions);
        const moyenne = moyenneDevoirs !== null && composition !== null
          ? Number(((moyenneDevoirs + composition) / 2).toFixed(2))
          : average(subjectNotes.map(normalize));

        return {
          matiereId: subject.matiereId,
          libelle: subject.libelle,
          code: subject.code,
          coefficient: subject.coefficient,
          enseignant: subject.enseignant
            ? `${subject.enseignant.firstName ?? ''} ${subject.enseignant.lastName ?? ''}`.trim()
            : null,
          devoirs: subjectNotes
            .filter((note) => note.typeEvaluation !== 'COMPOSITION')
            .map((note) => ({
              id: note.id,
              type: note.typeEvaluation,
              note: note.note,
              noteSur: note.noteSur,
              dateEvaluation: note.dateEvaluation?.toISOString() ?? null,
            })),
          composition: subjectNotes
            .filter((note) => note.typeEvaluation === 'COMPOSITION')
            .map((note) => ({
              id: note.id,
              note: note.note,
              noteSur: note.noteSur,
              dateEvaluation: note.dateEvaluation?.toISOString() ?? null,
            })),
          moyenneDevoirs,
          moyenne,
        };
      });

      return {
        code: periode,
        label: periode.replace('SEMESTRE_', 'Semestre '),
        matieres: subjects,
        moyenne: weightedAverage(subjects),
      };
    });

    const periodAverages = periodes.map((periode) => periode.moyenne).filter((value): value is number => value !== null);
    const moyenneAnnuelle = average(periodAverages);

    return {
      eleve: {
        id: eleve.id,
        nom: `${eleve.firstName ?? ''} ${eleve.lastName ?? ''}`.trim(),
        email: eleve.email,
        matricule: eleve.matricule,
        photoUrl: eleve.photoUrl,
      },
      classe: {
        id: classe.id,
        nom: classe.nom,
        annee: classe.anneeAcademique?.libelle ?? null,
        cycle: classe.niveau?.cycle?.libelle ?? null,
      },
      periodes,
      moyenneAnnuelle,
    };
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

    const existing = await this.prisma.classeStagiaire.findFirst({
      where: { classeId, stagiaireId, actif: true, dateFin: null },
    });
    if (existing) throw new ConflictException('Ce stagiaire est déjà rattaché à cette classe');

    await this.prisma.classeStagiaire.create({
      data: { tenantId, classeId, stagiaireId, dateDebut: new Date(), actif: true },
    });

    return this.getClasse(tenantId, classeId);
  }

  async removeStagiaire(tenantId: string, classeId: string, stagiaireId: string) {
    const entry = await this.prisma.classeStagiaire.findFirst({
      where: { classeId, stagiaireId, actif: true, dateFin: null },
    });
    if (!entry) throw new NotFoundException('Stagiaire non rattaché à cette classe');

    await this.prisma.classeStagiaire.update({
      where: { id: entry.id },
      data: { actif: false, dateFin: new Date() },
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
      where: { tenantId, actif: true },
      orderBy: { dateDebut: 'desc' },
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
        ? { id: classe.anneeAcademique.id, libelle: classe.anneeAcademique.libelle, courante: classe.anneeAcademique.actif }
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
        contratId: s.id,
        id: s.stagiaire.id,
        nom: `${s.stagiaire.firstName} ${s.stagiaire.lastName}`,
        email: s.stagiaire.email,
        specialite: s.stagiaire.specialite,
        photoUrl: s.stagiaire.photoUrl,
        dateDebut: s.dateDebut?.toISOString?.() ?? null,
        dateFin: s.dateFin?.toISOString?.() ?? null,
        actif: s.actif,
      })),
      nbEleves: classe._count?.eleves ?? 0,
      actif: classe.actif,
      isUnifiedSection,
      createdAt: classe.createdAt,
    };
  }
}
