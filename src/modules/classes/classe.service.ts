import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { StorageService } from '@/infrastructure/storage/storage.service';
import { BulletinDocumentService } from '@/modules/bulletin-document.service';
import { CreateClasseDto } from './dto/create-classe.dto';
import { UpdateClasseDto } from './dto/update-classe.dto';
import { StatutPresence } from '@prisma/client';

type QueryValue = string | string[] | undefined;
type TeacherQueryParams = Record<string, QueryValue>;

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly bulletinDocument: BulletinDocumentService,
  ) {}

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

  async getTeacherClasses(tenantId: string, enseignantId: string) {
    await this.assertTenantExists(tenantId);

    const classes = await this.prisma.classe.findMany({
      where: {
        tenantId,
        actif: true,
        OR: [
          { professeurResponsableId: enseignantId },
          { matiereClasses: { some: { enseignantId } } },
          { cours: { some: { enseignantId } } },
        ],
      },
      include: {
        ...CLASSE_INCLUDE,
        niveau: {
          include: {
            cycle: { select: { id: true, code: true, libelle: true } },
          },
        },
      },
      orderBy: [{ niveau: { ordre: 'asc' } }, { nom: 'asc' }],
    });

    return classes.map(this.toResponse);
  }

  async assertTeacherClasseAccess(tenantId: string, enseignantId: string, classeId: string): Promise<void> {
    const classe = await this.prisma.classe.findFirst({
      where: {
        id: classeId,
        tenantId,
        OR: [
          { professeurResponsableId: enseignantId },
          { matiereClasses: { some: { enseignantId } } },
          { cours: { some: { enseignantId } } },
        ],
      },
      select: { id: true },
    });
    if (!classe) throw new NotFoundException('Classe introuvable pour ce professeur');
  }

  async assertTeacherMatiereAccess(
    tenantId: string,
    enseignantId: string,
    classeId: string,
    matiereId: string,
  ): Promise<void> {
    const classe = await this.prisma.classe.findFirst({
      where: { id: classeId, tenantId },
      select: { professeurResponsableId: true },
    });
    if (!classe) throw new NotFoundException('Classe introuvable');
    if (classe.professeurResponsableId === enseignantId) return;

    const affectation = await this.prisma.matiereClasse.findFirst({
      where: { tenantId, classeId, matiereId, enseignantId },
      select: { id: true },
    });
    if (affectation) return;

    const cours = await this.prisma.cours.findFirst({
      where: { tenantId, classeId, matiereId, enseignantId },
      select: { id: true },
    });
    if (!cours) throw new BadRequestException('Matière non autorisée pour ce professeur dans cette classe');
  }

  async saveEleveComportement(
    tenantId: string,
    classeId: string,
    eleveId: string,
    dto: { trimestre?: string; appreciation?: string },
  ) {
    await this.assertEleveInClasse(tenantId, classeId, eleveId);
    const classe = await this.prisma.classe.findFirst({
      where: { id: classeId, tenantId },
      include: { anneeAcademique: true },
    });
    if (!classe) throw new NotFoundException('Classe introuvable');

    const trimestre = dto.trimestre || 'SEMESTRE_1';
    const anneeScolaire = classe.anneeAcademique?.libelle ?? '';
    const existing = await this.prisma.bulletin.findFirst({
      where: { tenantId, eleveId, classeId, trimestre, anneeScolaire },
      select: { id: true },
    });

    if (existing) {
      return this.prisma.bulletin.update({
        where: { id: existing.id },
        data: { appreciation: dto.appreciation ?? null },
      });
    }

    return this.prisma.bulletin.create({
      data: {
        tenantId,
        eleveId,
        classeId,
        trimestre,
        anneeScolaire,
        appreciation: dto.appreciation ?? null,
      },
    });
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
    const noteScale = ['MATERNELLE', 'PRIMAIRE', 'COLLEGE', 'CRECHE'].includes(cycleCode) ? 10 : 20;
    const anneeScolaire = classe.anneeAcademique?.libelle ?? '';

    const [cours, matiereClasses, notes, bulletins] = await Promise.all([
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
      this.prisma.bulletin.findMany({
        where: { tenantId, eleveId, classeId, anneeScolaire },
        select: { trimestre: true, appreciation: true },
      }),
    ]);

    const subjectsById = new Map<string, any>();
    for (const row of cours as any[]) {
      subjectsById.set(row.matiereId, {
        matiereId: row.matiereId,
        libelle: row.matiere.libelle,
        code: row.matiere.code,
        coefficient: row.coefficient ?? 1,
        professeur: null,
      });
    }
    for (const row of matiereClasses) {
      if (!subjectsById.has(row.matiereId)) {
        subjectsById.set(row.matiereId, {
          matiereId: row.matiereId,
          libelle: row.matiere.libelle,
          code: row.matiere.code,
          coefficient: 1,
          professeur: row.enseignant,
        });
      }
    }
    for (const note of notes) {
      if (!subjectsById.has(note.matiereId)) {
        subjectsById.set(note.matiereId, {
          matiereId: note.matiereId,
          libelle: note.matiere.libelle,
          code: note.matiere.code,
          coefficient: 1,
          professeur: null,
        });
      }
    }

    const normalize = (note: any) => Number((((note.note ?? 0) / (note.noteSur || noteScale)) * noteScale).toFixed(2));
    const average = (values: number[]) => values.length
      ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2))
      : null;
    const weightedAverage = (rows: { moyenne: number | null; coefficient: number }[]) => {
      const valid = rows.filter((row) => row.moyenne !== null);
      const totalCoeff = valid.reduce((sum, row) => sum + row.coefficient, 0);
      if (!valid.length || totalCoeff <= 0) return null;
      return Number((valid.reduce((sum, row) => sum + Number(row.moyenne) * row.coefficient, 0) / totalCoeff).toFixed(2));
    };

    const appreciationByPeriod = new Map(bulletins.map((bulletin) => [bulletin.trimestre, bulletin.appreciation]));

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
          professeur: subject.professeur
            ? `${subject.professeur.firstName ?? ''} ${subject.professeur.lastName ?? ''}`.trim()
            : null,
          devoirs: subjectNotes
            .filter((note) => note.typeEvaluation !== 'COMPOSITION')
            .map((note) => ({
              id: note.id,
              type: note.typeEvaluation,
              note: normalize(note),
              noteSur: noteScale,
              dateEvaluation: note.dateEvaluation?.toISOString() ?? null,
            })),
          composition: subjectNotes
            .filter((note) => note.typeEvaluation === 'COMPOSITION')
            .map((note) => ({
              id: note.id,
              note: normalize(note),
              noteSur: noteScale,
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
        appreciation: appreciationByPeriod.get(periode) ?? null,
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
        bareme: noteScale,
      },
      periodes,
      moyenneAnnuelle,
    };
  }

  async getClasseCours(tenantId: string, classeId: string, enseignantId: string) {
    const classe = await this.prisma.classe.findFirst({
      where: { id: classeId, tenantId },
      select: { professeurResponsableId: true },
    });
    if (!classe) throw new NotFoundException('Classe introuvable');

    const cours = await this.prisma.cours.findMany({
      where: {
        tenantId,
        classeId,
        ...(classe.professeurResponsableId === enseignantId ? {} : { enseignantId }),
      },
      include: {
        matiere: { select: { id: true, libelle: true, code: true } },
        emploisDuTemps: {
          where: { tenantId },
          select: { jourSemaine: true, heureDebut: true, heureFin: true },
          orderBy: { jourSemaine: 'asc' },
        },
      },
      orderBy: { matiere: { libelle: 'asc' } },
    });
    return cours.map((c) => ({
      id: c.id,
      matiereId: c.matiereId,
      libelle: c.matiere.libelle,
      code: c.matiere.code,
      slots: c.emploisDuTemps.map((e) => ({ jour: e.jourSemaine, heureDebut: e.heureDebut, heureFin: e.heureFin })),
    }));
  }

  async getClasseMatieres(tenantId: string, enseignantId: string, classeId: string) {
    await this.assertTeacherClasseAccess(tenantId, enseignantId, classeId);

    const matieres = await this.prisma.matiereClasse.findMany({
      where: { tenantId, classeId },
      include: {
        matiere: { select: { id: true, libelle: true, code: true } },
        enseignant: { select: PROF_SELECT },
      },
      orderBy: { matiere: { libelle: 'asc' } },
    });

    return matieres.map((row) => ({
      id: row.id,
      matiereId: row.matiereId,
      libelle: row.matiere.libelle,
      code: row.matiere.code,
      enseignantId: row.enseignantId,
      enseignantNom: row.enseignant ? `${row.enseignant.firstName ?? ''} ${row.enseignant.lastName ?? ''}`.trim() : null,
    }));
  }

  async createAppelWithLignes(
    tenantId: string,
    classeId: string,
    enseignantId: string,
    payload: {
      coursId?: string | null;
      session?: string | null;
      dateCours: string;
      heureDebut?: string | null;
      absents?: string[];
      lignes?: { eleveId: string; statut: StatutPresence }[];
    },
  ) {
    // For collège/lycée: validate coursId; for maternelle/primaire: coursId is null
    if (payload.coursId) {
      const cours = await this.prisma.cours.findFirst({ where: { id: payload.coursId, tenantId, classeId } });
      if (!cours) throw new NotFoundException('Cours introuvable');
    }

    const heureDebut = payload.heureDebut ?? (payload.session === 'MATIN' ? '08:00' : payload.session === 'APRES_MIDI' ? '15:00' : null);

    const inscriptions = await this.prisma.inscription.findMany({
      where: { tenantId, classeId, statut: 'ACTIF' },
      select: { eleveId: true },
    });

    const explicitLines = payload.lignes?.length ? new Map(payload.lignes.map((ligne) => [ligne.eleveId, ligne.statut])) : null;
    const appel = await this.prisma.appel.create({
      data: {
        tenantId,
        coursId: payload.coursId ?? null,
        classeId,
        dateCours: new Date(payload.dateCours),
        heureDebut: heureDebut ?? null,
        soumisPar: enseignantId,
        statut: 'SOUMIS',
        lignes: {
          create: inscriptions.map((i) => ({
            eleveId: i.eleveId,
            statut: explicitLines?.get(i.eleveId) ?? (payload.absents?.includes(i.eleveId) ? 'ABSENT' : 'PRESENT'),
          })),
        },
      },
      include: { lignes: true },
    });
    return appel;
  }

  async getClasseAppels(tenantId: string, classeId: string) {
    const appels = await this.prisma.appel.findMany({
      where: { tenantId, classeId },
      include: {
        cours: { select: { matiere: { select: { libelle: true, code: true } } } },
        lignes: { select: { eleveId: true, statut: true }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: [{ dateCours: 'desc' }, { heureDebut: 'desc' }, { createdAt: 'desc' }],
    });

    return appels.map((a) => ({
      id: a.id,
      dateCours: a.dateCours,
      heureDebut: a.heureDebut,
      statut: a.statut,
      coursLibelle: a.cours?.matiere?.libelle ?? (a.heureDebut && a.heureDebut < '13:00' ? 'Matin' : a.heureDebut ? 'Après-midi' : null),
      coursCode: a.cours?.matiere?.code ?? null,
      nbPresents: a.lignes.filter((l) => l.statut === 'PRESENT').length,
      nbAbsents: a.lignes.filter((l) => l.statut === 'ABSENT').length,
      nbRetards: a.lignes.filter((l) => l.statut === 'RETARD').length,
      lignes: a.lignes.map((l) => ({ eleveId: l.eleveId, statut: l.statut })),
    }));
  }

  async updateAppelLignes(
    tenantId: string,
    classeId: string,
    appelId: string,
    lignes: { eleveId: string; statut: string }[],
  ) {
    const appel = await this.prisma.appel.findFirst({ where: { id: appelId, tenantId, classeId } });
    if (!appel) throw new NotFoundException('Appel introuvable');

    await Promise.all(
      lignes.map((l) =>
        this.prisma.appelLigne.updateMany({
          where: { appelId, eleveId: l.eleveId },
          data: { statut: l.statut as any },
        }),
      ),
    );

    return this.getClasseAppels(tenantId, classeId);
  }

  async getTeacherEmploiDuTemps(tenantId: string, enseignantId: string) {
    const slots = await this.prisma.emploiDuTemps.findMany({
      where: {
        tenantId,
        OR: [
          { enseignantId },
          { cours: { enseignantId } },
        ],
      },
      include: {
        classe: { select: { id: true, nom: true } },
        cours: {
          include: {
            matiere: { select: { id: true, libelle: true, code: true } },
            classe: { select: { id: true, nom: true } },
          },
        },
        salle: { include: { batiment: { select: { id: true, nom: true } } } },
      },
      orderBy: [{ jourSemaine: 'asc' }, { heureDebut: 'asc' }],
    });
    return this.mapEmploiDuTempsRows(slots);
  }

  async exportTeacherEmploiDuTemps(tenantId: string, enseignantId: string) {
    const slots = await this.getTeacherEmploiDuTemps(tenantId, enseignantId);
    return this.csvExport(`emploi-du-temps-professeur-${this.dateOnly(new Date())}.csv`, [
      ['Jour', 'Heure debut', 'Heure fin', 'Classe', 'Matiere', 'Salle', 'Batiment'],
      ...slots.map((slot: any) => [
        slot.jourSemaine,
        slot.heureDebut,
        slot.heureFin,
        slot.classeNom,
        slot.matiereLibelle ?? slot.matiereCode ?? '',
        slot.salleNom ?? '',
        slot.salleBatimentNom ?? '',
      ]),
    ]);
  }

  async getTeacherNotes(tenantId: string, enseignantId: string, query: TeacherQueryParams = {}) {
    const classeId = this.firstQueryValue(query.classeId);
    const classes = await this.getTeacherClasseScope(tenantId, enseignantId, classeId);
    if (!classes.length) return this.pageResult([], 0, query);

    const classIds = classes.map((classe) => classe.id);
    const classeById = new Map(classes.map((classe) => [classe.id, classe]));
    const inscriptions = await this.prisma.inscription.findMany({
      where: {
        tenantId,
        classeId: { in: classIds },
        statut: 'ACTIF',
        ...(this.firstQueryValue(query.eleveId) ? { eleveId: this.firstQueryValue(query.eleveId) } : {}),
      },
      select: { eleveId: true, classeId: true, anneeAcademiqueId: true },
    });

    const inscriptionsByClasse = new Map<string, typeof inscriptions>();
    for (const inscription of inscriptions) {
      const rows = inscriptionsByClasse.get(inscription.classeId) ?? [];
      rows.push(inscription);
      inscriptionsByClasse.set(inscription.classeId, rows);
    }

    const noteScopes = classes.flatMap((classe) => {
      const rows = (inscriptionsByClasse.get(classe.id) ?? []).filter(
        (inscription) => !classe.anneeAcademiqueId || inscription.anneeAcademiqueId === classe.anneeAcademiqueId,
      );
      const eleveIds = rows.map((inscription) => inscription.eleveId);
      if (!eleveIds.length) return [];

      const isResponsable = classe.professeurResponsableId === enseignantId;
      const matiereIds = [
        ...new Set([
          ...classe.matiereClasses.map((matiereClasse) => matiereClasse.matiereId),
          ...classe.cours.map((cours) => cours.matiereId),
        ]),
      ];
      if (!isResponsable && !matiereIds.length) return [];

      return [
        {
          eleveId: { in: eleveIds },
          ...(classe.anneeAcademique?.libelle ? { anneeScolaire: classe.anneeAcademique.libelle } : {}),
          ...(!isResponsable ? { matiereId: { in: matiereIds } } : {}),
        },
      ];
    });

    if (!noteScopes.length) return this.pageResult([], 0, query);

    const where: Record<string, unknown> = {
      tenantId,
      OR: noteScopes,
      ...this.teacherNoteFilters(query),
    };
    const page = this.toQueryInt(query.page, 0);
    const size = this.toQueryInt(query.size, 20);

    const [notes, totalElements] = await Promise.all([
      this.prisma.note.findMany({
        where,
        skip: page * size,
        take: size,
        include: { matiere: { select: { id: true, code: true, libelle: true } } },
        orderBy: this.teacherOrderBy(query, [{ anneeScolaire: 'desc' }, { trimestre: 'asc' }, { createdAt: 'desc' }]),
      }),
      this.prisma.note.count({ where }),
    ]);

    const eleveIds = [...new Set(notes.map((note) => note.eleveId))];
    const eleves = eleveIds.length
      ? await this.prisma.user.findMany({
          where: { tenantId, id: { in: eleveIds }, role: 'ELEVE' },
          select: { id: true, firstName: true, lastName: true, matricule: true, photoUrl: true },
        })
      : [];
    const eleveById = new Map(eleves.map((eleve) => [eleve.id, eleve]));
    const inscriptionByEleveYear = new Map<string, (typeof inscriptions)[number]>();
    const inscriptionByEleve = new Map<string, (typeof inscriptions)[number]>();
    for (const inscription of inscriptions) {
      const classe = classeById.get(inscription.classeId);
      if (!inscriptionByEleve.has(inscription.eleveId)) {
        inscriptionByEleve.set(inscription.eleveId, inscription);
      }
      if (classe?.anneeAcademique?.libelle) {
        inscriptionByEleveYear.set(`${inscription.eleveId}:${classe.anneeAcademique.libelle}`, inscription);
      }
    }

    return this.pageResult(
      notes.map((note) => {
        const eleve = eleveById.get(note.eleveId);
        const inscription = inscriptionByEleveYear.get(`${note.eleveId}:${note.anneeScolaire}`) ?? inscriptionByEleve.get(note.eleveId);
        const classe = inscription ? classeById.get(inscription.classeId) : null;
        const eleveNom = eleve ? `${eleve.firstName ?? ''} ${eleve.lastName ?? ''}`.trim() : null;

        return {
          ...note,
          valeur: note.note,
          bareme: note.noteSur,
          classeId: classe?.id ?? null,
          classe: classe ? { id: classe.id, nom: classe.nom } : null,
          classeNom: classe?.nom ?? null,
          eleve: eleve
            ? {
                id: eleve.id,
                nom: eleveNom,
                firstName: eleve.firstName,
                lastName: eleve.lastName,
                matricule: eleve.matricule,
                photoUrl: eleve.photoUrl,
              }
            : null,
          eleveNom,
          matiereLibelle: note.matiere?.libelle ?? null,
          matiereCode: note.matiere?.code ?? null,
        };
      }),
      totalElements,
      query,
    );
  }

  async getTeacherBulletins(tenantId: string, enseignantId: string, query: TeacherQueryParams = {}) {
    const classeId = this.firstQueryValue(query.classeId);
    const classes = await this.getTeacherClasseScope(tenantId, enseignantId, classeId);
    if (!classes.length) return this.pageResult([], 0, query);

    const classIds = classes.map((classe) => classe.id);
    const page = this.toQueryInt(query.page, 0);
    const size = this.toQueryInt(query.size, 20);
    const where: Record<string, unknown> = {
      tenantId,
      classeId: { in: classIds },
      ...this.teacherBulletinFilters(query),
    };

    const [bulletins, totalElements] = await Promise.all([
      this.prisma.bulletin.findMany({
        where,
        skip: page * size,
        take: size,
        include: { classe: { select: { id: true, nom: true } } },
        orderBy: this.teacherOrderBy(query, [{ anneeScolaire: 'desc' }, { trimestre: 'asc' }, { createdAt: 'desc' }]),
      }),
      this.prisma.bulletin.count({ where }),
    ]);

    const eleveIds = [...new Set(bulletins.map((bulletin) => bulletin.eleveId))];
    const eleves = eleveIds.length
      ? await this.prisma.user.findMany({
          where: { tenantId, id: { in: eleveIds }, role: 'ELEVE' },
          select: { id: true, firstName: true, lastName: true, matricule: true, photoUrl: true },
        })
      : [];
    const eleveById = new Map(eleves.map((eleve) => [eleve.id, eleve]));

    return this.pageResult(
      bulletins.map((bulletin) => {
        const eleve = eleveById.get(bulletin.eleveId);
        const eleveNom = eleve ? `${eleve.firstName ?? ''} ${eleve.lastName ?? ''}`.trim() : null;

        return {
          ...bulletin,
          eleve: eleve
            ? {
                id: eleve.id,
                nom: eleveNom,
                firstName: eleve.firstName,
                lastName: eleve.lastName,
                matricule: eleve.matricule,
                photoUrl: eleve.photoUrl,
              }
            : null,
          eleveNom,
          classeNom: bulletin.classe?.nom ?? null,
          moyenneGenerale: bulletin.moyenne,
        };
      }),
      totalElements,
      query,
    );
  }

  async exportTeacherClassNotes(tenantId: string, enseignantId: string, classeId: string) {
    await this.assertTeacherClasseAccess(tenantId, enseignantId, classeId);

    const classe = await this.prisma.classe.findFirst({
      where: { id: classeId, tenantId },
      include: { anneeAcademique: true },
    });
    if (!classe) throw new NotFoundException('Classe introuvable');

    const inscriptions = await this.prisma.inscription.findMany({
      where: {
        tenantId,
        classeId,
        statut: 'ACTIF',
        ...(classe.anneeAcademiqueId ? { anneeAcademiqueId: classe.anneeAcademiqueId } : {}),
      },
      select: { eleveId: true },
    });
    const eleveIds = inscriptions.map((inscription) => inscription.eleveId);
    if (!eleveIds.length) {
      return this.csvExport(`notes-${this.safeFilename(classe.nom)}.csv`, [
        ['Eleve', 'Matricule', 'Classe', 'Matiere', 'Periode', 'Type', 'Note', 'Bareme', 'Date', 'Commentaire'],
      ]);
    }

    const isResponsable = classe.professeurResponsableId === enseignantId;
    const matieresAutorisees = isResponsable
      ? []
      : await Promise.all([
          this.prisma.matiereClasse.findMany({
            where: { tenantId, classeId, enseignantId },
            select: { matiereId: true },
          }),
          this.prisma.cours.findMany({
            where: { tenantId, classeId, enseignantId },
            select: { matiereId: true },
          }),
        ]);
    const allowedMatiereIds = isResponsable
      ? []
      : [...new Set(matieresAutorisees.flat().map((matiere) => matiere.matiereId))];

    const [eleves, notes] = await Promise.all([
      this.prisma.user.findMany({
        where: { tenantId, id: { in: eleveIds }, role: 'ELEVE' },
        select: { id: true, firstName: true, lastName: true, matricule: true },
      }),
      this.prisma.note.findMany({
        where: {
          tenantId,
          eleveId: { in: eleveIds },
          ...(classe.anneeAcademique?.libelle ? { anneeScolaire: classe.anneeAcademique.libelle } : {}),
          ...(!isResponsable ? { matiereId: { in: allowedMatiereIds } } : {}),
        },
        include: { matiere: { select: { code: true, libelle: true } } },
        orderBy: [
          { trimestre: 'asc' },
          { matiere: { libelle: 'asc' } },
          { dateEvaluation: 'asc' },
        ],
      }),
    ]);
    const eleveById = new Map(eleves.map((eleve) => [eleve.id, eleve]));

    return this.csvExport(`notes-${this.safeFilename(classe.nom)}-${this.dateOnly(new Date())}.csv`, [
      ['Eleve', 'Matricule', 'Classe', 'Matiere', 'Periode', 'Type', 'Note', 'Bareme', 'Date', 'Commentaire'],
      ...notes.map((note) => {
        const eleve = eleveById.get(note.eleveId);
        return [
          eleve ? `${eleve.firstName ?? ''} ${eleve.lastName ?? ''}`.trim() : note.eleveId,
          eleve?.matricule ?? '',
          classe.nom,
          note.matiere?.libelle ?? note.matiere?.code ?? '',
          note.trimestre,
          note.typeEvaluation,
          note.note,
          note.noteSur,
          this.dateOnly(note.dateEvaluation),
          note.commentaire ?? '',
        ];
      }),
    ]);
  }

  async exportTeacherStudentBulletin(tenantId: string, enseignantId: string, classeId: string, eleveId: string) {
    await this.assertTeacherClasseAccess(tenantId, enseignantId, classeId);
    const bulletin = await this.prisma.bulletin.findFirst({
      where: { tenantId, classeId, eleveId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, trimestre: true },
    });
    if (!bulletin) {
      throw new NotFoundException('Aucun bulletin généré pour cet élève');
    }

    const { buffer } = await this.bulletinDocument.generate(tenantId, bulletin.id);
    const key = this.storage.buildBulletinKey(tenantId, eleveId, bulletin.trimestre);
    const fichierPdfUrl = await this.storage.upload(key, buffer, 'application/pdf');
    await this.prisma.bulletin.update({ where: { id: bulletin.id }, data: { fichierPdfUrl } });

    return { id: bulletin.id, format: 'pdf', url: fichierPdfUrl, fichierPdfUrl };
  }

  async getTeacherReclamations(tenantId: string, enseignantId: string) {
    const classes = await this.prisma.classe.findMany({
      where: {
        tenantId,
        actif: true,
        OR: [
          { professeurResponsableId: enseignantId },
          { matiereClasses: { some: { enseignantId } } },
          { cours: { some: { enseignantId } } },
        ],
      },
      select: { id: true },
    });
    const classeIds = classes.map((classe) => classe.id);
    if (!classeIds.length) return [];

    const inscriptions = await this.prisma.inscription.findMany({
      where: { tenantId, classeId: { in: classeIds }, statut: 'ACTIF' },
      select: { eleveId: true },
    });
    const eleveIds = [...new Set(inscriptions.map((inscription) => inscription.eleveId))];
    if (!eleveIds.length) return [];

    const [reclamations, eleves] = await Promise.all([
      this.prisma.reclamation.findMany({
        where: { tenantId, eleveId: { in: eleveIds } },
        include: {
          note: {
            include: {
              matiere: { select: { id: true, libelle: true, code: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.findMany({
        where: { tenantId, id: { in: eleveIds }, role: 'ELEVE' },
        select: { id: true, firstName: true, lastName: true, matricule: true },
      }),
    ]);

    const eleveById = new Map(eleves.map((eleve) => [eleve.id, eleve]));
    return reclamations.map((reclamation) => {
      const eleve = eleveById.get(reclamation.eleveId);
      return {
        id: reclamation.id,
        eleveId: reclamation.eleveId,
        eleve: eleve
          ? {
              id: eleve.id,
              nom: `${eleve.firstName ?? ''} ${eleve.lastName ?? ''}`.trim(),
              matricule: eleve.matricule,
            }
          : null,
        eleveNom: eleve ? `${eleve.firstName ?? ''} ${eleve.lastName ?? ''}`.trim() : null,
        noteId: reclamation.noteId,
        matiere: reclamation.note?.matiere ?? null,
        matiereLibelle: reclamation.note?.matiere?.libelle ?? null,
        trimestre: reclamation.note?.trimestre ?? null,
        typeEvaluation: reclamation.note?.typeEvaluation ?? null,
        commentaire: reclamation.note?.commentaire ?? null,
        note: reclamation.note?.note ?? null,
        noteSur: reclamation.note?.noteSur ?? null,
        motif: reclamation.motif,
        statut: reclamation.statut,
        reponse: reclamation.reponse,
        pieceJointeUrl: (reclamation as any).pieceJointeUrl ?? null,
        createdAt: reclamation.createdAt,
        updatedAt: reclamation.updatedAt,
      };
    });
  }

  async traiterTeacherReclamation(
    tenantId: string,
    enseignantId: string,
    reclamationId: string,
    dto: { statut?: string; reponse?: string; nouvelleNote?: number; noteSur?: number },
  ) {
    const reclamation = await this.prisma.reclamation.findFirst({
      where: { id: reclamationId, tenantId },
      include: { note: true },
    });
    if (!reclamation) throw new NotFoundException('Réclamation introuvable');

    const classes = await this.prisma.classe.findMany({
      where: {
        tenantId,
        actif: true,
        OR: [
          { professeurResponsableId: enseignantId },
          { matiereClasses: { some: { enseignantId } } },
          { cours: { some: { enseignantId } } },
        ],
      },
      select: { id: true },
    });
    const classeIds = classes.map((classe) => classe.id);
    const inscription = await this.prisma.inscription.findFirst({
      where: { tenantId, eleveId: reclamation.eleveId, classeId: { in: classeIds }, statut: 'ACTIF' },
      select: { id: true },
    });
    if (!inscription) throw new NotFoundException('Réclamation introuvable pour ce professeur');

    const statut = dto.statut === 'REJETEE' ? 'REJETEE' : 'TRAITEE';
    if (statut === 'TRAITEE' && reclamation.noteId && dto.nouvelleNote !== undefined && dto.nouvelleNote !== null) {
      const note = Number(dto.nouvelleNote);
      const noteSur = dto.noteSur !== undefined && dto.noteSur !== null ? Number(dto.noteSur) : reclamation.note?.noteSur;
      if (Number.isNaN(note) || note < 0) throw new BadRequestException('Note invalide');
      if (noteSur && note > noteSur) throw new BadRequestException('La note ne peut pas dépasser le barème');
      await this.prisma.note.update({
        where: { id: reclamation.noteId },
        data: {
          note,
          ...(noteSur ? { noteSur } : {}),
        },
      });
    }

    return this.prisma.reclamation.update({
      where: { id: reclamation.id },
      data: {
        statut,
        reponse: dto.reponse?.trim() || (statut === 'TRAITEE' ? 'Réclamation traitée.' : 'Réclamation rejetée.'),
      },
    });
  }

  async getTeacherAbsences(tenantId: string, enseignantId: string) {
    const personnel = await this.prisma.personnel.findFirst({
      where: { tenantId, utilisateurId: enseignantId },
      select: { id: true },
    });
    if (!personnel) return [];

    return this.prisma.absencePersonnel.findMany({
      where: { tenantId, personnelId: personnel.id },
      orderBy: { dateDebut: 'desc' },
    });
  }

  async createTeacherAbsence(
    tenantId: string,
    enseignantId: string,
    dto: { dateDebut?: string; dateFin?: string; heureDebut?: string; heureFin?: string; motif?: string; typeAbsence?: string; justificatifUrl?: string },
  ) {
    let personnel = await this.prisma.personnel.findFirst({
      where: { tenantId, utilisateurId: enseignantId },
      select: { id: true },
    });
    // Auto-création du dossier personnel si absent (professeur sans fiche RH)
    if (!personnel) {
      const user = await this.prisma.user.findFirst({
        where: { id: enseignantId, tenantId, role: 'ENSEIGNANT' },
        select: { id: true },
      });
      if (!user) throw new NotFoundException('Utilisateur introuvable');
      personnel = await this.prisma.personnel.create({
        data: { tenantId, utilisateurId: enseignantId },
        select: { id: true },
      });
    }

    if (!dto.dateDebut || !dto.dateFin) {
      throw new BadRequestException('Les dates de début et de fin sont obligatoires');
    }
    const dateDebut = new Date(dto.dateDebut);
    const dateFin = new Date(dto.dateFin);
    if (Number.isNaN(dateDebut.getTime()) || Number.isNaN(dateFin.getTime())) {
      throw new BadRequestException('Dates invalides');
    }
    if (dateFin < dateDebut) {
      throw new BadRequestException('La date de fin doit être supérieure ou égale à la date de début');
    }
    const heureDebut = dto.heureDebut?.trim() || null;
    const heureFin = dto.heureFin?.trim() || null;
    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
    if ((heureDebut && !timePattern.test(heureDebut)) || (heureFin && !timePattern.test(heureFin))) {
      throw new BadRequestException('Heure invalide');
    }
    if (dateDebut.getTime() === dateFin.getTime() && heureDebut && heureFin && heureFin <= heureDebut) {
      throw new BadRequestException('L\'heure de fin doit être après l\'heure de début');
    }

    return this.prisma.absencePersonnel.create({
      data: {
        tenantId,
        personnelId: personnel.id,
        dateDebut,
        dateFin,
        heureDebut,
        heureFin,
        motif: dto.motif?.trim() || null,
        typeAbsence: (dto.typeAbsence || 'AUTRE') as any,
        justificatifUrl: dto.justificatifUrl?.trim() || null,
        statut: 'EN_ATTENTE',
      } as any,
    });
  }

  async getConseilClasseActif(tenantId: string, today: Date) {
    const events = await this.prisma.calendrierScolaire.findMany({
      where: {
        tenantId,
        type: 'CONSEIL_CLASSE',
        dateDebut: { lte: today },
        OR: [{ dateFin: null }, { dateFin: { gte: today } }],
      },
      select: { id: true, titre: true, dateDebut: true, dateFin: true, sectionId: true },
    });
    return events;
  }

  async getEleveHistorique(tenantId: string, currentClasseId: string, eleveId: string) {
    const inscriptions = await this.prisma.inscription.findMany({
      where: { tenantId, eleveId, NOT: { classeId: currentClasseId } },
      include: {
        classe: {
          include: {
            niveau: { include: { cycle: true } },
            anneeAcademique: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    const results = await Promise.all(
      inscriptions
        .filter((i) => i.classe)
        .map(async (i) => {
          const classe = i.classe!;
          const cycleCode = classe.niveau?.cycle?.code?.toUpperCase() ?? '';
          const noteScale = ['MATERNELLE', 'PRIMAIRE', 'COLLEGE', 'CRECHE'].includes(cycleCode) ? 10 : 20;
          const periods = ['MATERNELLE', 'PRIMAIRE', 'CRECHE'].includes(cycleCode)
            ? ['SEMESTRE_1', 'SEMESTRE_2', 'SEMESTRE_3']
            : ['SEMESTRE_1', 'SEMESTRE_2'];
          const anneeScolaire = classe.anneeAcademique?.libelle ?? '';

          const [notes, cours] = await Promise.all([
            this.prisma.note.findMany({ where: { tenantId, eleveId, anneeScolaire } }),
            this.prisma.cours.findMany({
              where: { tenantId, classeId: classe.id },
              select: { matiereId: true, coefficient: true },
            }),
          ]);

          const coeffByMatiere = new Map(cours.map((c) => [c.matiereId, c.coefficient ?? 1]));
          const normalize = (n: any) => Number((((n.note ?? 0) / (n.noteSur || noteScale)) * noteScale).toFixed(2));
          const avg = (values: number[]) =>
            values.length ? Number((values.reduce((s, v) => s + v, 0) / values.length).toFixed(2)) : null;

          const periodes = periods.map((periode) => {
            const periodNotes = notes.filter((n) => n.trimestre === periode);
            const matiereIds = [...new Set(periodNotes.map((n) => n.matiereId))];
            const matiereAverages = matiereIds.map((matiereId) => ({
              moyenne: avg(periodNotes.filter((n) => n.matiereId === matiereId).map(normalize)),
              coefficient: coeffByMatiere.get(matiereId) ?? 1,
            }));
            const valid = matiereAverages.filter((m) => m.moyenne !== null);
            const totalCoeff = valid.reduce((s, m) => s + m.coefficient, 0);
            const moyenne =
              valid.length && totalCoeff > 0
                ? Number((valid.reduce((s, m) => s + m.moyenne! * m.coefficient, 0) / totalCoeff).toFixed(2))
                : null;
            return { code: periode, label: periode.replace('SEMESTRE_', 'Semestre '), moyenne };
          });

          const moyenneAnnuelle = avg(periodes.map((p) => p.moyenne).filter((m): m is number => m !== null));

          return {
            classe: {
              id: classe.id,
              nom: classe.nom,
              annee: classe.anneeAcademique?.libelle ?? null,
              cycle: classe.niveau?.cycle?.libelle ?? null,
              bareme: noteScale,
            },
            periodes,
            moyenneAnnuelle,
          };
        }),
    );

    return results;
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
    const classe = await this.prisma.classe.findFirst({
      where: { id: classeId, tenantId },
      include: { niveau: { include: { cycle: true } } },
    });
    if (!classe) throw new NotFoundException('Classe introuvable');
    const cycleCode = ((classe as any).niveau?.cycle?.code ?? '').toUpperCase();
    if (!['MATERNELLE', 'PRIMAIRE', 'CRECHE'].includes(cycleCode)) {
      throw new ConflictException('Les stagiaires ne sont disponibles que pour les classes Crèche / Maternelle / Primaire');
    }

    const stagiaire = await this.prisma.user.findFirst({
      where: { id: stagiaireId, tenantId, role: 'ENSEIGNANT' },
    });
    if (!stagiaire) throw new NotFoundException('Enseignant introuvable');

    const existing = await this.prisma.classeStagiaire.findFirst({
      where: { classeId, stagiaireId, actif: true, dateFin: null },
    });
    if (existing) throw new ConflictException('Ce stagiaire est déjà rattaché à cette classe');

    const previousContract = await this.prisma.classeStagiaire.findFirst({
      where: { classeId, stagiaireId, actif: false },
      orderBy: { dateFin: 'desc' },
    });

    if (previousContract) {
      await this.prisma.classeStagiaire.update({
        where: { id: previousContract.id },
        data: { dateDebut: new Date(), dateFin: null, actif: true },
      });
    } else {
      await this.prisma.classeStagiaire.create({
        data: { tenantId, classeId, stagiaireId, dateDebut: new Date(), actif: true },
      });
    }

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

  async getProfesseurs(tenantId: string) {
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

  private async getTeacherClasseScope(tenantId: string, enseignantId: string, classeId?: string) {
    const classes = await this.prisma.classe.findMany({
      where: {
        tenantId,
        actif: true,
        ...(classeId ? { id: classeId } : {}),
        OR: [
          { professeurResponsableId: enseignantId },
          { matiereClasses: { some: { enseignantId } } },
          { cours: { some: { enseignantId } } },
        ],
      },
      select: {
        id: true,
        nom: true,
        professeurResponsableId: true,
        anneeAcademiqueId: true,
        anneeAcademique: { select: { id: true, libelle: true } },
        niveau: { select: { cycle: { select: { code: true } } } },
        matiereClasses: {
          where: { enseignantId },
          select: { matiereId: true },
        },
        cours: {
          where: { enseignantId },
          select: { matiereId: true },
        },
      },
      orderBy: { nom: 'asc' },
    });

    return classes;
  }

  private teacherNoteFilters(query: TeacherQueryParams): Record<string, unknown> {
    const filters: Record<string, unknown> = {};
    const eleveId = this.firstQueryValue(query.eleveId);
    const matiereId = this.firstQueryValue(query.matiereId);
    const trimestre = this.firstQueryValue(query.trimestre) ?? this.firstQueryValue(query.periode);
    const anneeScolaire = this.firstQueryValue(query.anneeScolaire);
    const typeEvaluation =
      this.firstQueryValue(query.typeEvaluation) ??
      this.firstQueryValue(query.typeEval) ??
      this.firstQueryValue(query.type);

    if (eleveId) filters.eleveId = eleveId;
    if (matiereId) filters.matiereId = matiereId;
    if (trimestre) filters.trimestre = trimestre;
    if (anneeScolaire) filters.anneeScolaire = anneeScolaire;
    if (typeEvaluation) filters.typeEvaluation = typeEvaluation;

    return filters;
  }

  private teacherBulletinFilters(query: TeacherQueryParams): Record<string, unknown> {
    const filters: Record<string, unknown> = {};
    const eleveId = this.firstQueryValue(query.eleveId);
    const trimestre = this.firstQueryValue(query.trimestre) ?? this.firstQueryValue(query.periode);
    const anneeScolaire = this.firstQueryValue(query.anneeScolaire);
    const statut = this.firstQueryValue(query.statut);

    if (eleveId) filters.eleveId = eleveId;
    if (trimestre) filters.trimestre = trimestre;
    if (anneeScolaire) filters.anneeScolaire = anneeScolaire;
    if (statut) filters.statut = statut;

    return filters;
  }

  private teacherOrderBy(query: TeacherQueryParams, fallback: unknown): any {
    const sortBy = this.firstQueryValue(query.sortBy) ?? this.firstQueryValue(query.sort);
    if (!sortBy) return fallback;
    const direction =
      this.firstQueryValue(query.asc) === 'false' || this.firstQueryValue(query.ascending) === 'false' ? 'desc' : 'asc';
    return { [sortBy]: direction };
  }

  private pageResult<T>(content: T[], totalElements: number, query: TeacherQueryParams) {
    const page = this.toQueryInt(query.page, 0);
    const size = this.toQueryInt(query.size, 20);
    const totalPages = size > 0 ? Math.ceil(totalElements / size) : 0;
    return {
      content,
      page,
      size,
      totalElements,
      totalPages,
      first: page === 0,
      last: page >= totalPages - 1 || totalPages === 0,
    };
  }

  private toQueryInt(value: QueryValue, fallback: number): number {
    const parsed = Number(this.firstQueryValue(value));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  private firstQueryValue(value: QueryValue): string | undefined {
    return Array.isArray(value) ? value[0] : value;
  }

  private async assertTenantExists(tenantId: string): Promise<void> {
    const exists = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Tenant introuvable');
  }

  private async assertEleveInClasse(tenantId: string, classeId: string, eleveId: string): Promise<void> {
    const classe = await this.prisma.classe.findFirst({
      where: { id: classeId, tenantId },
      select: { anneeAcademiqueId: true },
    });
    if (!classe) throw new NotFoundException('Classe introuvable');

    const inscription = await this.prisma.inscription.findFirst({
      where: {
        tenantId,
        classeId,
        eleveId,
        statut: 'ACTIF',
        ...(classe.anneeAcademiqueId ? { anneeAcademiqueId: classe.anneeAcademiqueId } : {}),
      },
      select: { id: true },
    });
    if (!inscription) throw new NotFoundException('Élève introuvable dans cette classe');
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

  private async mapEmploiDuTempsRows(rows: any[]) {
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
        jourSemaine: row.jourSemaine,
        heureDebut: row.heureDebut,
        heureFin: row.heureFin,
        classeId: row.classeId ?? row.cours?.classeId ?? null,
        classeNom: row.classe?.nom ?? row.cours?.classe?.nom ?? '',
        matiereId,
        matiereLibelle: matiere?.libelle ?? '',
        matiereCode: matiere?.code ?? '',
        enseignantId,
        enseignantNom: enseignant ? `${enseignant.firstName ?? ''} ${enseignant.lastName ?? ''}`.trim() : null,
        salleId: row.salleId,
        salleNom: row.salle?.nom ?? null,
        salleBatimentNom: row.salle?.batiment?.nom ?? null,
        coursId: row.coursId,
        anneeScolaire: row.anneeScolaire,
        dateDebutValidite: row.dateDebutValidite,
        dateFinValidite: row.dateFinValidite,
        publie: row.publie,
      };
    });
  }

  private csvExport(filename: string, rows: unknown[][]) {
    return {
      filename,
      mimeType: 'text/csv;charset=utf-8',
      content: rows.map((row) => row.map((value) => this.csvCell(value)).join(';')).join('\n'),
    };
  }

  private csvCell(value: unknown): string {
    if (value === null || value === undefined) return '';
    const text = value instanceof Date ? this.dateOnly(value) : String(value);
    const escaped = text.replace(/"/g, '""');
    return /[;"\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
  }

  private dateOnly(value?: Date | string | null): string {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().substring(0, 10);
  }

  private safeFilename(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'export';
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
