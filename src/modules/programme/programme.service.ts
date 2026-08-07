import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';

@Injectable()
export class ProgrammeService {
  private readonly logger = new Logger(ProgrammeService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── CRUD Programmes ───────────────────────────────────────────────────

  async findAll(tenantId: string, filters: { niveauId?: string; matiereId?: string; anneeAcademiqueId?: string; statut?: string; niveauIdsAutorises?: string[] | null }) {
    const where: Record<string, unknown> = { tenantId };
    if (filters.niveauId) where.niveauId = filters.niveauId;
    if (filters.matiereId) where.matiereId = filters.matiereId;
    if (filters.anneeAcademiqueId) where.anneeAcademiqueId = filters.anneeAcademiqueId;
    if (filters.statut) where.statut = filters.statut;
    /**
     * Cloisonnement par cycle. `ProgrammePedagogique.niveauId` est une colonne
     * simple sans relation Prisma vers `Niveau` : on filtre donc sur une liste
     * de niveaux déjà résolue par `CycleScopeService`.
     *
     * L'intersection avec un `niveauId` fourni par l'appelant est volontaire :
     * demander un niveau hors périmètre ne doit rien renvoyer, pas élargir le
     * résultat.
     */
    if (filters.niveauIdsAutorises) {
      const autorises = filters.niveauId
        ? filters.niveauIdsAutorises.filter((id) => id === filters.niveauId)
        : filters.niveauIdsAutorises;
      delete where.niveauId;
      where.niveauId = { in: autorises };
    }

    const programmes = await this.prisma.programmePedagogique.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      include: {
        anneeAcademique: { select: { libelle: true } },
        chapitres: { orderBy: { numero: 'asc' }, select: { id: true } },
      },
    });

    // Fetch niveau + matiere names
    const niveauIds = [...new Set(programmes.map((p) => p.niveauId))];
    const matiereIds = [...new Set(programmes.map((p) => p.matiereId))];

    const [niveaux, matieres] = await Promise.all([
      niveauIds.length ? this.prisma.niveau.findMany({ where: { id: { in: niveauIds } }, select: { id: true, libelle: true } }) : [],
      matiereIds.length ? this.prisma.matiere.findMany({ where: { id: { in: matiereIds } }, select: { id: true, libelle: true } }) : [],
    ]);

    const niveauMap = new Map(niveaux.map((n) => [n.id, n.libelle]));
    const matiereMap = new Map(matieres.map((m) => [m.id, m.libelle]));

    return programmes.map((p) => ({
      ...p,
      niveauNom: niveauMap.get(p.niveauId) ?? '—',
      matiereNom: matiereMap.get(p.matiereId) ?? '—',
      nbChapitres: p.chapitres.length,
      chapitres: undefined,
    }));
  }

  async findOne(tenantId: string, id: string) {
    const prog = await this.prisma.programmePedagogique.findFirst({
      where: { id, tenantId },
      include: {
        anneeAcademique: { select: { libelle: true } },
        chapitres: { orderBy: { numero: 'asc' } },
      },
    });
    if (!prog) throw new NotFoundException('Programme introuvable');

    const [niveau, matiere] = await Promise.all([
      this.prisma.niveau.findUnique({ where: { id: prog.niveauId }, select: { libelle: true } }),
      this.prisma.matiere.findUnique({ where: { id: prog.matiereId }, select: { libelle: true } }),
    ]);

    return { ...prog, niveauNom: niveau?.libelle ?? '—', matiereNom: matiere?.libelle ?? '—' };
  }

  async create(tenantId: string, dto: {
    niveauId: string; matiereId: string; anneeAcademiqueId: string;
    titre: string; description?: string;
  }) {
    if (!dto.titre?.trim()) throw new BadRequestException('Titre requis');
    if (!dto.niveauId || !dto.matiereId || !dto.anneeAcademiqueId) throw new BadRequestException('Niveau, matière et année requis');

    return this.prisma.programmePedagogique.create({
      data: {
        tenantId,
        niveauId: dto.niveauId,
        matiereId: dto.matiereId,
        anneeAcademiqueId: dto.anneeAcademiqueId,
        titre: dto.titre.trim(),
        description: dto.description?.trim() || null,
      },
    });
  }

  async update(tenantId: string, id: string, dto: Partial<{
    titre: string; description: string; statut: string; valideParCellule: boolean;
  }>) {
    const existing = await this.prisma.programmePedagogique.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Programme introuvable');

    const data: Record<string, unknown> = {};
    if (dto.titre !== undefined) data.titre = dto.titre.trim();
    if (dto.description !== undefined) data.description = dto.description?.trim() || null;
    if (dto.statut !== undefined) data.statut = dto.statut;
    if (dto.valideParCellule !== undefined) {
      data.valideParCellule = dto.valideParCellule;
      if (dto.valideParCellule) data.dateValidation = new Date();
    }

    return this.prisma.programmePedagogique.update({ where: { id }, data });
  }

  async remove(tenantId: string, id: string) {
    const existing = await this.prisma.programmePedagogique.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Programme introuvable');
    await this.prisma.programmePedagogique.delete({ where: { id } });
  }

  async valider(tenantId: string, id: string) {
    const existing = await this.prisma.programmePedagogique.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Programme introuvable');
    return this.prisma.programmePedagogique.update({
      where: { id },
      data: { statut: 'VALIDE', valideParCellule: true, dateValidation: new Date() },
    });
  }

  async dupliquer(tenantId: string, id: string, nouvelleAnneeId: string) {
    const original = await this.prisma.programmePedagogique.findFirst({
      where: { id, tenantId },
      include: { chapitres: { orderBy: { numero: 'asc' } } },
    });
    if (!original) throw new NotFoundException('Programme introuvable');

    const newProg = await this.prisma.programmePedagogique.create({
      data: {
        tenantId,
        niveauId: original.niveauId,
        matiereId: original.matiereId,
        anneeAcademiqueId: nouvelleAnneeId,
        titre: original.titre,
        description: original.description,
        statut: 'BROUILLON',
      },
    });

    for (const ch of original.chapitres) {
      await this.prisma.chapitreProgamme.create({
        data: {
          programmeId: newProg.id,
          numero: ch.numero,
          titre: ch.titre,
          description: ch.description,
          objectifs: ch.objectifs,
          competences: ch.competences,
          ressources: ch.ressources,
          prerequis: ch.prerequis,
          periode: ch.periode,
          semaineDebut: ch.semaineDebut,
          semaineFin: ch.semaineFin,
          dateLimite: ch.dateLimite,
          volumeHoraire: ch.volumeHoraire,
          nbSeances: ch.nbSeances,
          evaluationPrevue: ch.evaluationPrevue,
          typeEvaluation: ch.typeEvaluation,
        },
      });
    }

    return newProg;
  }

  // ── CRUD Chapitres ────────────────────────────────────────────────────

  async addChapitre(tenantId: string, programmeId: string, dto: {
    titre: string; description?: string; objectifs?: string; competences?: string;
    ressources?: string; prerequis?: string; periode: string;
    semaineDebut?: number; semaineFin?: number; dateLimite: string;
    volumeHoraire?: number; nbSeances?: number;
    evaluationPrevue?: boolean; typeEvaluation?: string;
  }) {
    const prog = await this.prisma.programmePedagogique.findFirst({ where: { id: programmeId, tenantId } });
    if (!prog) throw new NotFoundException('Programme introuvable');

    const lastCh = await this.prisma.chapitreProgamme.findFirst({
      where: { programmeId },
      orderBy: { numero: 'desc' },
      select: { numero: true },
    });
    const numero = (lastCh?.numero ?? 0) + 1;

    return this.prisma.chapitreProgamme.create({
      data: {
        programmeId,
        numero,
        titre: dto.titre.trim(),
        description: dto.description?.trim() || null,
        objectifs: dto.objectifs?.trim() || null,
        competences: dto.competences?.trim() || null,
        ressources: dto.ressources?.trim() || null,
        prerequis: dto.prerequis?.trim() || null,
        periode: dto.periode,
        semaineDebut: dto.semaineDebut ?? null,
        semaineFin: dto.semaineFin ?? null,
        dateLimite: new Date(dto.dateLimite),
        volumeHoraire: dto.volumeHoraire ?? null,
        nbSeances: dto.nbSeances ?? null,
        evaluationPrevue: dto.evaluationPrevue ?? false,
        typeEvaluation: dto.typeEvaluation || null,
      },
    });
  }

  async updateChapitre(tenantId: string, programmeId: string, chapitreId: string, dto: Partial<{
    titre: string; description: string; objectifs: string; competences: string;
    ressources: string; prerequis: string; periode: string; numero: number;
    semaineDebut: number; semaineFin: number; dateLimite: string;
    volumeHoraire: number; nbSeances: number;
    evaluationPrevue: boolean; typeEvaluation: string;
  }>) {
    const prog = await this.prisma.programmePedagogique.findFirst({ where: { id: programmeId, tenantId } });
    if (!prog) throw new NotFoundException('Programme introuvable');

    const data: Record<string, unknown> = {};
    if (dto.titre !== undefined) data.titre = dto.titre.trim();
    if (dto.description !== undefined) data.description = dto.description?.trim() || null;
    if (dto.objectifs !== undefined) data.objectifs = dto.objectifs?.trim() || null;
    if (dto.competences !== undefined) data.competences = dto.competences?.trim() || null;
    if (dto.ressources !== undefined) data.ressources = dto.ressources?.trim() || null;
    if (dto.prerequis !== undefined) data.prerequis = dto.prerequis?.trim() || null;
    if (dto.periode !== undefined) data.periode = dto.periode;
    if (dto.numero !== undefined) data.numero = dto.numero;
    if (dto.semaineDebut !== undefined) data.semaineDebut = dto.semaineDebut;
    if (dto.semaineFin !== undefined) data.semaineFin = dto.semaineFin;
    if (dto.dateLimite !== undefined) data.dateLimite = new Date(dto.dateLimite);
    if (dto.volumeHoraire !== undefined) data.volumeHoraire = dto.volumeHoraire;
    if (dto.nbSeances !== undefined) data.nbSeances = dto.nbSeances;
    if (dto.evaluationPrevue !== undefined) data.evaluationPrevue = dto.evaluationPrevue;
    if (dto.typeEvaluation !== undefined) data.typeEvaluation = dto.typeEvaluation || null;

    return this.prisma.chapitreProgamme.update({ where: { id: chapitreId }, data });
  }

  async removeChapitre(tenantId: string, programmeId: string, chapitreId: string) {
    const prog = await this.prisma.programmePedagogique.findFirst({ where: { id: programmeId, tenantId } });
    if (!prog) throw new NotFoundException('Programme introuvable');
    await this.prisma.chapitreProgamme.delete({ where: { id: chapitreId } });
  }

  // ── Avancement ────────────────────────────────────────────────────────

  async getAvancement(tenantId: string, filters: { niveauId?: string; anneeAcademiqueId?: string; classeId?: string; enseignantId?: string }) {
    const where: Record<string, unknown> = { tenantId };
    if (filters.niveauId) where.niveauId = filters.niveauId;
    if (filters.anneeAcademiqueId) where.anneeAcademiqueId = filters.anneeAcademiqueId;
    // If classeId provided, resolve niveauId from it
    if (filters.classeId && !filters.niveauId) {
      const classe = await this.prisma.classe.findUnique({ where: { id: filters.classeId }, select: { niveauId: true, anneeAcademiqueId: true } });
      if (classe?.niveauId) where.niveauId = classe.niveauId;
      if (classe?.anneeAcademiqueId && !filters.anneeAcademiqueId) where.anneeAcademiqueId = classe.anneeAcademiqueId;
    }

    // Cahier texte filter for specific enseignant
    const cahierWhere: Record<string, unknown> = {};
    if (filters.enseignantId) {
      cahierWhere.cours = { enseignantId: filters.enseignantId };
    }

    const programmes = await this.prisma.programmePedagogique.findMany({
      where,
      include: {
        anneeAcademique: { select: { libelle: true } },
        chapitres: {
          orderBy: { numero: 'asc' },
          include: {
            cahiersTexte: {
              where: Object.keys(cahierWhere).length > 0 ? cahierWhere : undefined,
              include: {
                cours: {
                  include: {
                    enseignant: { select: { id: true, firstName: true, lastName: true } },
                    classe: { select: { id: true, nom: true } },
                  },
                },
              },
              orderBy: { dateCours: 'desc' as const },
            },
          },
        },
      },
    });

    const niveauIds = [...new Set(programmes.map((p) => p.niveauId))];
    const matiereIds = [...new Set(programmes.map((p) => p.matiereId))];
    const [niveaux, matieres] = await Promise.all([
      niveauIds.length ? this.prisma.niveau.findMany({ where: { id: { in: niveauIds } }, select: { id: true, libelle: true } }) : [],
      matiereIds.length ? this.prisma.matiere.findMany({ where: { id: { in: matiereIds } }, select: { id: true, libelle: true } }) : [],
    ]);
    const niveauMap = new Map(niveaux.map((n) => [n.id, n.libelle]));
    const matiereMap = new Map(matieres.map((m) => [m.id, m.libelle]));

    const today = new Date();

    return (programmes as any[]).map((prog: any) => {
      const totalChapitres = prog.chapitres.length;
      const chapitresTraites = prog.chapitres.filter((ch: any) => ch.statut === 'TERMINE' || ch.cahiersTexte.length > 0).length;
      const pourcentage = totalChapitres > 0 ? Math.round((chapitresTraites / totalChapitres) * 100) : 0;

      const chapitresEnRetard = prog.chapitres.filter((ch: any) =>
        ch.statut !== 'TERMINE' && ch.dateLimite < today && ch.cahiersTexte.length === 0,
      ).length;

      const chapitresDetail = prog.chapitres.map((ch: any) => {
        const traite = ch.statut === 'TERMINE' || ch.cahiersTexte.length > 0;
        const enRetard = !traite && ch.dateLimite < today;
        const joursRetard = enRetard ? Math.floor((today.getTime() - ch.dateLimite.getTime()) / (1000 * 60 * 60 * 24)) : 0;
        return {
          id: ch.id,
          numero: ch.numero,
          titre: ch.titre,
          dateLimite: ch.dateLimite,
          periode: ch.periode,
          statut: ch.statut,
          traite,
          enRetard,
          joursRetard,
          nbSeances: ch.cahiersTexte.length,
          cahiersTexte: (ch.cahiersTexte ?? []).map((ct: any) => ({
            id: ct.id,
            dateCours: ct.dateCours,
            contenuTraite: ct.contenuTraite,
            observations: ct.observations,
            enseignantNom: ct.cours?.enseignant ? `${ct.cours.enseignant.firstName ?? ''} ${ct.cours.enseignant.lastName ?? ''}`.trim() : null,
            enseignantId: ct.cours?.enseignantId ?? null,
            classeNom: ct.cours?.classe?.nom ?? null,
            classeId: ct.cours?.classe?.id ?? null,
          })),
        };
      });

      return {
        programmeId: prog.id,
        niveauId: prog.niveauId,
        niveauNom: niveauMap.get(prog.niveauId) ?? '—',
        matiereId: prog.matiereId,
        matiereNom: matiereMap.get(prog.matiereId) ?? '—',
        annee: prog.anneeAcademique.libelle,
        statut: prog.statut,
        totalChapitres,
        chapitresTraites,
        pourcentage,
        chapitresEnRetard,
        chapitres: chapitresDetail,
      };
    });
  }
}
