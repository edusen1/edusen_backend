import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { WhatsappService } from '@/modules/whatsapp/whatsapp.service';
import { SaveFraisDto, FraisNiveauItemDto } from './dto/save-frais.dto';

export interface FraisNiveauResponse {
  section: string;
  niveau: string;
  inscription: number;
  mensualite: number;
  nbMois: number;
  moisDebut?: number;
  moisFin?: number;
  moyennePassage: number;
  actif: boolean;
}

export interface AnneeAcademiqueResponse {
  id: string;
  libelle: string;
  dateDebut: string;
  dateFin?: string | null;
  active: boolean;
  statut: 'OUVERTE' | 'CLOTUREE';
}

export interface SectionResponse {
  id: string;
  code: string;
  nom: string;
  actif: boolean;
}

export interface NiveauResponse {
  id: string;
  sectionId: string;
  section: string;
  code: string;
  nom: string;
  ordre: number;
  moyennePassage: number;
  actif: boolean;
}

export interface CalendrierScolaireResponse {
  id: string;
  sectionId?: string | null;
  section?: string | null;
  titre: string;
  description?: string | null;
  dateDebut: string;
  dateFin?: string | null;
  type: string;
}

type CycleRow = {
  id: string;
  code: string;
  libelle: string;
  actif: boolean;
};

type NiveauRow = {
  id: string;
  cycleId: string;
  code: string;
  libelle: string;
  ordre: number;
  moyennePassage: number;
  actif: boolean;
  cycle: {
    id: string;
    libelle: string;
  };
};

type AnneeRow = {
  id: string;
  libelle: string;
  dateDebut: Date;
  dateFin: Date | null;
  estCourante: boolean;
  actif: boolean;
};

const DEFAULT_STRUCTURE = [
  {
    code: 'MATERNELLE',
    nom: 'Maternelle',
    niveaux: [
      { code: 'PS', nom: 'Petite Section', ordre: 1 },
      { code: 'MS', nom: 'Moyenne Section', ordre: 2 },
      { code: 'GS', nom: 'Grande Section', ordre: 3 },
    ],
  },
  {
    code: 'PRIMAIRE',
    nom: 'Primaire',
    niveaux: [
      { code: 'CI', nom: 'CI', ordre: 10 },
      { code: 'CP', nom: 'CP', ordre: 11 },
      { code: 'CE1', nom: 'CE1', ordre: 12 },
      { code: 'CE2', nom: 'CE2', ordre: 13 },
      { code: 'CM1', nom: 'CM1', ordre: 14 },
      { code: 'CM2', nom: 'CM2', ordre: 15 },
    ],
  },
  {
    code: 'COLLEGE',
    nom: 'Collège',
    niveaux: [
      { code: '6E', nom: '6ème', ordre: 20 },
      { code: '5E', nom: '5ème', ordre: 21 },
      { code: '4E', nom: '4ème', ordre: 22 },
      { code: '3E', nom: '3ème', ordre: 23 },
    ],
  },
  {
    code: 'LYCEE',
    nom: 'Lycée',
    niveaux: [
      { code: '2NDE', nom: 'Seconde', ordre: 30 },
      { code: '1ERE', nom: 'Première', ordre: 31 },
      { code: 'TLE', nom: 'Terminale', ordre: 32 },
    ],
  },
] as const;

@Injectable()
export class AcademiqueConfigService {
  private readonly logger = new Logger(AcademiqueConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
  ) {}

  // ----------------------------------------------------------------
  // Frais
  // ----------------------------------------------------------------

  async getFrais(tenantId: string): Promise<FraisNiveauResponse[]> {
    await this.assertTenantExists(tenantId);
    await this.ensureDefaultAcademicSetup(tenantId);
    const rows = await this.prisma.fraisNiveauConfig.findMany({
      where: { tenantId },
      orderBy: [{ section: 'asc' }, { niveau: 'asc' }],
    });
    const niveaux = await this.prisma.niveau.findMany({
      where: { tenantId },
      include: { cycle: { select: { libelle: true } } },
    });
    const moyenneByKey = new Map(
      niveaux.map((niveau) => [this.fraisKey(niveau.cycle.libelle, niveau.libelle), niveau.moyennePassage ?? 10]),
    );

    return rows.map((row) => this.toFraisResponse(row, moyenneByKey.get(this.fraisKey(row.section, row.niveau)) ?? 10));
  }

  async saveFrais(tenantId: string, dto: SaveFraisDto): Promise<FraisNiveauResponse[]> {
    await this.assertTenantExists(tenantId);

    // Upsert each item — unique by (tenantId, section, niveau)
    await Promise.all(
      dto.frais.map(async (item: FraisNiveauItemDto) => {
        await this.prisma.fraisNiveauConfig.upsert({
          where: { tenantId_section_niveau: { tenantId, section: item.section, niveau: item.niveau } },
          create: {
            tenantId,
            section: item.section,
            niveau: item.niveau,
            inscription: item.inscription,
            mensualite: item.mensualite,
            nbMois: item.nbMois,
            moisDebut: item.moisDebut ?? null,
            moisFin: item.moisFin ?? null,
            actif: item.actif ?? true,
          },
          update: {
            inscription: item.inscription,
            mensualite: item.mensualite,
            nbMois: item.nbMois,
            moisDebut: item.moisDebut ?? null,
            moisFin: item.moisFin ?? null,
            actif: item.actif ?? true,
          },
        });

        if (item.moyennePassage !== undefined) {
          await this.updateNiveauMoyennePassage(tenantId, item.section, item.niveau, item.moyennePassage);
        }
      }),
    );

    return this.getFrais(tenantId);
  }

  // ----------------------------------------------------------------
  // Sections (alias Cycles) — lecture via Prisma
  // Les mutations passent par le CRUD générique /v1/cycles
  // ----------------------------------------------------------------

  async getSections(tenantId: string): Promise<SectionResponse[]> {
    await this.assertTenantExists(tenantId);
    await this.ensureDefaultAcademicSetup(tenantId);
    const cycles = (await this.prisma.cycle.findMany({
      where: { tenantId },
      orderBy: { libelle: 'asc' },
    })) as CycleRow[];
    return cycles.map((c: CycleRow) => ({ id: c.id, code: c.code, nom: c.libelle, actif: c.actif }));
  }

  async createSection(tenantId: string, nom: string): Promise<SectionResponse> {
    await this.assertTenantExists(tenantId);
    const code = this.slugCode(nom);
    const created = await this.prisma.cycle.create({
      data: { tenantId, code, libelle: nom.trim(), actif: true },
    });
    return { id: created.id, code: created.code, nom: created.libelle, actif: created.actif };
  }

  async updateSection(tenantId: string, id: string, dto: Partial<{ nom: string; actif: boolean }>): Promise<SectionResponse> {
    await this.assertTenantExists(tenantId);
    const existing = await this.prisma.cycle.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Section introuvable');

    const updated = await this.prisma.cycle.update({
      where: { id },
      data: {
        ...(dto.nom ? { libelle: dto.nom.trim(), code: this.slugCode(dto.nom) } : {}),
        ...(dto.actif !== undefined ? { actif: dto.actif } : {}),
      },
    });
    return { id: updated.id, code: updated.code, nom: updated.libelle, actif: updated.actif };
  }

  // ----------------------------------------------------------------
  // Niveaux (alias Niveaux)
  // ----------------------------------------------------------------

  async getNiveaux(tenantId: string, sectionId?: string): Promise<NiveauResponse[]> {
    await this.assertTenantExists(tenantId);
    await this.ensureDefaultAcademicSetup(tenantId);
    const rows = (await this.prisma.niveau.findMany({
      where: { tenantId, ...(sectionId ? { cycleId: sectionId } : {}) },
      include: { cycle: { select: { id: true, libelle: true } } },
      orderBy: [{ ordre: 'asc' }, { libelle: 'asc' }],
    })) as NiveauRow[];
    return rows.map((n: NiveauRow) => ({
      id: n.id,
      sectionId: n.cycleId,
      section: n.cycle.libelle,
      code: n.code,
      nom: n.libelle,
      ordre: n.ordre,
      moyennePassage: n.moyennePassage ?? 10,
      actif: n.actif,
    }));
  }

  async createNiveau(tenantId: string, dto: { sectionId: string; nom: string; ordre?: number; moyennePassage?: number }): Promise<NiveauResponse> {
    await this.assertTenantExists(tenantId);
    const section = await this.prisma.cycle.findFirst({ where: { id: dto.sectionId, tenantId } });
    if (!section) throw new NotFoundException('Section introuvable');

    const count = await this.prisma.niveau.count({ where: { tenantId, cycleId: dto.sectionId } });
    const created = await this.prisma.niveau.create({
      data: {
        tenantId,
        cycleId: dto.sectionId,
        code: this.slugCode(dto.nom),
        libelle: dto.nom.trim(),
        ordre: dto.ordre ?? count + 1,
        moyennePassage: dto.moyennePassage ?? 10,
        actif: true,
      },
      include: { cycle: { select: { id: true, libelle: true } } },
    });
    return {
      id: created.id,
      sectionId: created.cycleId,
      section: created.cycle.libelle,
      code: created.code,
      nom: created.libelle,
      ordre: created.ordre,
      moyennePassage: created.moyennePassage ?? 10,
      actif: created.actif,
    };
  }

  async updateNiveau(tenantId: string, id: string, dto: Partial<{ nom: string; ordre: number; moyennePassage: number; actif: boolean }>): Promise<NiveauResponse> {
    await this.assertTenantExists(tenantId);
    const existing = await this.prisma.niveau.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Niveau introuvable');

    const updated = await this.prisma.niveau.update({
      where: { id },
      data: {
        ...(dto.nom ? { libelle: dto.nom.trim(), code: this.slugCode(dto.nom) } : {}),
        ...(dto.ordre !== undefined ? { ordre: dto.ordre } : {}),
        ...(dto.moyennePassage !== undefined ? { moyennePassage: dto.moyennePassage } : {}),
        ...(dto.actif !== undefined ? { actif: dto.actif } : {}),
      },
      include: { cycle: { select: { id: true, libelle: true } } },
    });
    return {
      id: updated.id,
      sectionId: updated.cycleId,
      section: updated.cycle.libelle,
      code: updated.code,
      nom: updated.libelle,
      ordre: updated.ordre,
      moyennePassage: updated.moyennePassage ?? 10,
      actif: updated.actif,
    };
  }

  // ----------------------------------------------------------------
  // Calendrier scolaire
  // ----------------------------------------------------------------

  async getCalendrier(tenantId: string, sectionId?: string): Promise<CalendrierScolaireResponse[]> {
    await this.assertTenantExists(tenantId);
    await this.ensureDefaultAcademicSetup(tenantId);
    const rows = await this.prisma.calendrierScolaire.findMany({
      where: { tenantId, ...(sectionId ? { sectionId } : {}) },
      include: { section: { select: { libelle: true } } },
      orderBy: [{ dateDebut: 'asc' }, { titre: 'asc' }],
    });
    return rows.map((row) => this.toCalendrierResponse(row));
  }

  async createCalendrier(
    tenantId: string,
    dto: {
      sectionId?: string | null;
      titre: string;
      description?: string | null;
      dateDebut: string;
      dateFin?: string | null;
      type?: string;
    },
  ): Promise<CalendrierScolaireResponse> {
    await this.assertTenantExists(tenantId);
    await this.assertSectionBelongsToTenant(tenantId, dto.sectionId);
    const created = await this.prisma.calendrierScolaire.create({
      data: {
        tenantId,
        sectionId: dto.sectionId || null,
        titre: dto.titre.trim(),
        description: dto.description?.trim() || null,
        dateDebut: new Date(dto.dateDebut),
        dateFin: dto.dateFin ? new Date(dto.dateFin) : null,
        type: dto.type || 'AUTRE',
      },
      include: { section: { select: { libelle: true } } },
    });
    const response = this.toCalendrierResponse(created);
    this.notifyCalendrier(tenantId, response, 'create').catch((e) =>
      this.logger.warn(`[Notif calendrier] ${(e as Error).message}`),
    );
    return response;
  }

  async updateCalendrier(
    tenantId: string,
    id: string,
    dto: Partial<{
      sectionId: string | null;
      titre: string;
      description: string | null;
      dateDebut: string;
      dateFin: string | null;
      type: string;
    }>,
  ): Promise<CalendrierScolaireResponse> {
    await this.assertTenantExists(tenantId);
    await this.assertSectionBelongsToTenant(tenantId, dto.sectionId);
    const existing = await this.prisma.calendrierScolaire.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!existing) throw new NotFoundException('Événement introuvable');

    const updated = await this.prisma.calendrierScolaire.update({
      where: { id },
      data: {
        ...(dto.sectionId !== undefined ? { sectionId: dto.sectionId || null } : {}),
        ...(dto.titre !== undefined ? { titre: dto.titre.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
        ...(dto.dateDebut !== undefined ? { dateDebut: new Date(dto.dateDebut) } : {}),
        ...(dto.dateFin !== undefined ? { dateFin: dto.dateFin ? new Date(dto.dateFin) : null } : {}),
        ...(dto.type !== undefined ? { type: dto.type || 'AUTRE' } : {}),
      },
      include: { section: { select: { libelle: true } } },
    });
    return this.toCalendrierResponse(updated);
  }

  async deleteCalendrier(tenantId: string, id: string): Promise<void> {
    await this.assertTenantExists(tenantId);
    const existing = await this.prisma.calendrierScolaire.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!existing) throw new NotFoundException('Événement introuvable');
    await this.prisma.calendrierScolaire.delete({ where: { id } });
  }

  // ----------------------------------------------------------------
  // Années académiques — lecture via Prisma
  // Les mutations passent par le CRUD générique /v1/annees-academiques
  // ----------------------------------------------------------------

  async getAnnees(tenantId: string): Promise<AnneeAcademiqueResponse[]> {
    await this.assertTenantExists(tenantId);
    const rows = (await this.prisma.anneeAcademique.findMany({
      where: { tenantId },
      orderBy: { dateDebut: 'desc' },
    })) as AnneeRow[];

    // L'annee en cours est l'annee active metier.
    const activeRow = rows.find((r: AnneeRow) => r.actif) ?? rows[0] ?? null;
    return rows.map((r: AnneeRow, i: number) => {
      const isActive = activeRow ? r.id === activeRow.id : i === 0;
      return {
        id: r.id,
        libelle: r.libelle,
        dateDebut: r.dateDebut.toISOString(),
        dateFin: r.dateFin?.toISOString() ?? null,
        active: isActive,
        statut: isActive ? 'OUVERTE' : 'CLOTUREE',
      };
    });
  }

  async getAnneeCourante(tenantId: string): Promise<AnneeAcademiqueResponse | null> {
    const annees = await this.getAnnees(tenantId);
    return annees.find((annee) => annee.active) ?? annees[0] ?? null;
  }

  async createAnnee(tenantId: string, dto: { libelle: string; active?: boolean; estCourante?: boolean }): Promise<AnneeAcademiqueResponse> {
    await this.assertTenantExists(tenantId);
    const active = dto.active ?? dto.estCourante ?? false;
    const existing = await this.prisma.anneeAcademique.findFirst({ where: { tenantId, libelle: dto.libelle } });
    if (existing) throw new ConflictException('Une année avec ce libellé existe déjà');

    if (active) {
      await this.prisma.anneeAcademique.updateMany({
        where: { tenantId, OR: [{ estCourante: true }, { actif: true }] },
        data: { estCourante: false, actif: false, dateFin: new Date() },
      });
      await this.prisma.classe.updateMany({
        where: { tenantId },
        data: { actif: false },
      });
    }

    const created = await this.prisma.anneeAcademique.create({
      data: {
        tenantId,
        libelle: dto.libelle,
        dateDebut: new Date(),
        dateFin: null,
        estCourante: active,
        actif: active,
      },
    });

    if (active) {
      await this.duplicateClassesOnceForYear(tenantId, created.id);
      await this.syncClassActivityForActiveYear(tenantId, created.id);
    }

    const anneeResponse: AnneeAcademiqueResponse = {
      id: created.id,
      libelle: created.libelle,
      dateDebut: created.dateDebut.toISOString(),
      dateFin: created.dateFin?.toISOString() ?? null,
      active: created.actif,
      statut: created.actif ? 'OUVERTE' : 'CLOTUREE',
    };

    this.notifyNouvelleAnnee(tenantId, anneeResponse).catch((e) =>
      this.logger.warn(`[Notif annee] ${(e as Error).message}`),
    );

    return anneeResponse;
  }

  async activateAnnee(tenantId: string, id: string): Promise<AnneeAcademiqueResponse> {
    await this.assertTenantExists(tenantId);
    const annee = await this.prisma.anneeAcademique.findFirst({ where: { id, tenantId } });
    if (!annee) throw new NotFoundException('Année académique introuvable');

    await this.prisma.anneeAcademique.updateMany({
      where: { tenantId, id: { not: id }, OR: [{ estCourante: true }, { actif: true }] },
      data: { estCourante: false, actif: false, dateFin: new Date() },
    });
    const updated = await this.prisma.anneeAcademique.update({
      where: { id },
      data: { estCourante: true, actif: true, dateFin: null },
    });
    await this.duplicateClassesOnceForYear(tenantId, id);
    await this.syncClassActivityForActiveYear(tenantId, id);

    return {
      id: updated.id,
      libelle: updated.libelle,
      dateDebut: updated.dateDebut.toISOString(),
      dateFin: updated.dateFin?.toISOString() ?? null,
      active: updated.actif,
      statut: updated.actif ? 'OUVERTE' : 'CLOTUREE',
    };
  }

  // ----------------------------------------------------------------
  // Utils
  // ----------------------------------------------------------------

  private async assertTenantExists(tenantId: string): Promise<void> {
    const exists = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Tenant introuvable');
  }

  private async assertSectionBelongsToTenant(tenantId: string, sectionId?: string | null): Promise<void> {
    if (!sectionId) return;
    const section = await this.prisma.cycle.findFirst({ where: { id: sectionId, tenantId }, select: { id: true } });
    if (!section) throw new NotFoundException('Section introuvable');
  }

  private async ensureDefaultAcademicSetup(tenantId: string): Promise<void> {
    for (const section of DEFAULT_STRUCTURE) {
      const cycle = await this.prisma.cycle.upsert({
        where: { tenantId_code: { tenantId, code: section.code } },
        create: { tenantId, code: section.code, libelle: section.nom, actif: true },
        update: { libelle: section.nom },
      });

      for (const niveau of section.niveaux) {
        await this.prisma.niveau.upsert({
          where: { tenantId_code: { tenantId, code: niveau.code } },
          create: {
            tenantId,
            cycleId: cycle.id,
            code: niveau.code,
            libelle: niveau.nom,
            ordre: niveau.ordre,
            moyennePassage: 10,
            actif: true,
          },
          update: {
            cycleId: cycle.id,
            libelle: niveau.nom,
            ordre: niveau.ordre,
          },
        });

        await this.prisma.fraisNiveauConfig.upsert({
          where: { tenantId_section_niveau: { tenantId, section: section.nom, niveau: niveau.nom } },
          create: {
            tenantId,
            section: section.nom,
            niveau: niveau.nom,
            inscription: 0,
            mensualite: 0,
            nbMois: 9,
            moisDebut: 10,
            moisFin: 6,
            actif: true,
          },
          update: {},
        });
      }
    }
  }

  private async duplicateClassesOnceForYear(tenantId: string, targetAnneeId: string): Promise<void> {
    const targetAnnee = await this.prisma.anneeAcademique.findFirst({
      where: { id: targetAnneeId, tenantId },
      select: { id: true, dateDebut: true, classesDupliquees: true },
    });
    if (!targetAnnee || targetAnnee.classesDupliquees) return;

    const sourceAnnee = await this.prisma.anneeAcademique.findFirst({
      where: { tenantId, id: { not: targetAnnee.id }, dateDebut: { lt: targetAnnee.dateDebut } },
      orderBy: { dateDebut: 'desc' },
      select: { id: true },
    });
    if (!sourceAnnee) return;

    const sourceClasses = await this.prisma.classe.findMany({
      where: { tenantId, anneeAcademiqueId: sourceAnnee.id },
      select: { nom: true, niveauId: true, effectifMax: true, professeurResponsableId: true },
    });

    for (const classe of sourceClasses) {
      const exists = await this.prisma.classe.findFirst({
        where: { tenantId, nom: classe.nom, anneeAcademiqueId: targetAnnee.id },
        select: { id: true },
      });
      if (exists) continue;

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
    }

    await this.prisma.classe.updateMany({
      where: { tenantId, anneeAcademiqueId: sourceAnnee.id },
      data: { actif: false },
    });
    await this.prisma.anneeAcademique.update({
      where: { id: targetAnnee.id },
      data: { classesDupliquees: true },
    });
  }

  private async syncClassActivityForActiveYear(tenantId: string, activeAnneeId: string): Promise<void> {
    await this.prisma.classe.updateMany({
      where: { tenantId, anneeAcademiqueId: { not: activeAnneeId } },
      data: { actif: false },
    });
    await this.prisma.classe.updateMany({
      where: { tenantId, anneeAcademiqueId: activeAnneeId },
      data: { actif: true },
    });
  }

  private slugCode(value: string): string {
    return value
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 20);
  }

  private async updateNiveauMoyennePassage(tenantId: string, section: string, niveau: string, moyennePassage: number): Promise<void> {
    await this.prisma.niveau.updateMany({
      where: {
        tenantId,
        libelle: niveau,
        cycle: { libelle: section },
      },
      data: { moyennePassage },
    });
  }

  private fraisKey(section: string, niveau: string): string {
    return `${section.trim().toLowerCase()}::${niveau.trim().toLowerCase()}`;
  }

  private toFraisResponse(row: {
    section: string;
    niveau: string;
    inscription: number;
    mensualite: number;
    nbMois: number;
    moisDebut: number | null;
    moisFin: number | null;
    actif: boolean;
  }, moyennePassage: number): FraisNiveauResponse {
    return {
      section: row.section,
      niveau: row.niveau,
      inscription: row.inscription,
      mensualite: row.mensualite,
      nbMois: row.nbMois,
      moisDebut: row.moisDebut ?? undefined,
      moisFin: row.moisFin ?? undefined,
      moyennePassage,
      actif: row.actif,
    };
  }

  // ----------------------------------------------------------------
  // Notifications WhatsApp (fire-and-forget)
  // ----------------------------------------------------------------

  private readonly WA_ROLES = ['ELEVE', 'PARENT', 'ENSEIGNANT'];

  private async notifyCalendrier(
    tenantId: string,
    evt: CalendrierScolaireResponse,
    action: 'create' | 'update',
  ): Promise<void> {
    const dateDebut = new Date(evt.dateDebut).toLocaleDateString('fr-FR');
    const dateFin = evt.dateFin ? ` → ${new Date(evt.dateFin).toLocaleDateString('fr-FR')}` : '';
    const type = evt.type ?? 'Événement';
    const verb = action === 'create' ? 'Nouvel événement' : 'Mise à jour';
    const section = evt.section ? ` [${evt.section}]` : '';

    const message =
      `📅 *${verb} au calendrier scolaire*${section}\n` +
      `📌 *${evt.titre}*\n` +
      (evt.description ? `📝 ${evt.description}\n` : '') +
      `🗓️ ${dateDebut}${dateFin}\n` +
      `🏷️ Type : ${type}`;

    await this.whatsapp.broadcastToRoles(tenantId, message, this.WA_ROLES);
  }

  private async notifyNouvelleAnnee(tenantId: string, annee: AnneeAcademiqueResponse): Promise<void> {
    const dateDebut = new Date(annee.dateDebut).toLocaleDateString('fr-FR');
    const statut = annee.active ? 'en cours ✅' : 'créée';
    const message =
      `🎓 *Nouvelle année académique ${statut}*\n` +
      `📚 *${annee.libelle}*\n` +
      `📅 Début : ${dateDebut}`;

    await this.whatsapp.broadcastToRoles(tenantId, message, this.WA_ROLES);
  }

  private toCalendrierResponse(row: {
    id: string;
    sectionId: string | null;
    section?: { libelle: string } | null;
    titre: string;
    description: string | null;
    dateDebut: Date;
    dateFin: Date | null;
    type: string | null;
  }): CalendrierScolaireResponse {
    return {
      id: row.id,
      sectionId: row.sectionId,
      section: row.section?.libelle ?? null,
      titre: row.titre,
      description: row.description,
      dateDebut: row.dateDebut.toISOString(),
      dateFin: row.dateFin?.toISOString() ?? null,
      type: row.type ?? 'AUTRE',
    };
  }
}
