import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AsyncSemaphore } from '@/common/utils/async.util';
import { PrismaService } from '@/config/prisma.service';
import { StorageService } from '@/infrastructure/storage/storage.service';

export type RapportType =
  | 'bulletins'
  | 'absences-eleves'
  | 'paiements'
  | 'inscriptions'
  | 'pointages'
  | 'emplois-du-temps'
  | 'communications'
  | 'audit';

export interface RapportParams {
  anneeScolaire?: string;
  trimestre?: string;
  classeId?: string;
  statut?: string;
  dateFrom?: string;
  dateTo?: string;
  anneeId?: string;
  limit?: string;
  annees?: string;      // comma-separated libellés "2025-2026,2024-2025" or "*" for all
  anneeIds?: string;    // comma-separated UUIDs (alternative)
}

interface SchoolInfo {
  name: string;
  address: string;
  phone: string;
  email: string;
  logoUrl: string | null;
  primaryColor: string;
}

interface AnalysisItem {
  label: string;
  value: string;
  color?: string;       // hex color for the value
  highlight?: boolean;  // render with accent background
}

interface AnalysisSection {
  title: string;
  items: AnalysisItem[];
}

interface ReportData {
  title: string;
  subtitle: string;
  paramsText: string;
  headers: string[];
  rows: string[][];
  totalLabel?: string;
  analysis?: AnalysisSection[];
}

interface ResolvedYear {
  id: string;
  libelle: string;
  dateDebut: Date;
  dateFin: Date | null;
}

interface EvolutionRow {
  label: string;
  values: Map<string, string>;   // year libelle → formatted value
  numValues: Map<string, number>; // year libelle → raw number (for delta calc)
  unit?: string;
  higherIsBetter?: boolean;       // true = green if up, false = green if down
}

interface ComparativeReportData {
  title: string;
  subtitle: string;
  years: string[];
  evolutionRows: EvolutionRow[];
  combinedHeaders: string[];
  combinedRows: string[][];
  totalLabel?: string;
}

const semaphore = new AsyncSemaphore(Math.max(1, Number(process.env.RAPPORT_PDF_CONCURRENCY ?? 1)));

const RAPPORT_TITLES: Record<RapportType, string> = {
  'bulletins': 'Rapport — Bulletins de notes',
  'absences-eleves': 'Rapport — Absences élèves',
  'paiements': 'Rapport — Paiements & Recouvrement',
  'inscriptions': 'Rapport — Inscriptions & Effectifs',
  'pointages': 'Rapport — Présences du personnel',
  'emplois-du-temps': 'Rapport — Emplois du temps',
  'communications': 'Rapport — Communications',
  'audit': 'Rapport — Journal d\'audit',
};

@Injectable()
export class RapportDocumentService implements OnModuleDestroy {
  private readonly logger = new Logger(RapportDocumentService.name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private browserPromise: Promise<any> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async onModuleDestroy(): Promise<void> {
    if (!this.browserPromise) return;
    try {
      const browser = await this.browserPromise;
      await browser.close();
    } catch {
      // ignore on shutdown
    } finally {
      this.browserPromise = null;
    }
  }

  async generate(
    tenantId: string,
    type: RapportType,
    params: RapportParams,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const school = await this.getSchoolInfo(tenantId);
    const years = await this.resolveYears(tenantId, params);
    const today = new Date().toISOString().slice(0, 10);

    if (years.length <= 1) {
      // Single-year or no year filter: existing behavior
      const singleParams = years.length === 1 ? this.buildYearParams(type, years[0], params) : params;
      const data = await this.fetchData(tenantId, type, singleParams);
      const html = this.renderHtml(school, data);
      const buffer = await semaphore.run(() => this.renderPdf(html));
      return { buffer, filename: `rapport-${type}-${today}.pdf` };
    }

    // Multi-year: fetch in parallel, build comparative
    const yearDataEntries = await Promise.all(
      years.map(async (year) => {
        const yParams = this.buildYearParams(type, year, params);
        const data = await this.fetchData(tenantId, type, yParams);
        return [year.libelle, data] as [string, ReportData];
      }),
    );
    const yearDataMap = new Map(yearDataEntries);
    const comparative = this.buildComparativeReport(type, years.map((y) => y.libelle), yearDataMap);
    const html = this.renderComparativeHtml(school, comparative);
    const buffer = await semaphore.run(() => this.renderPdf(html));
    return { buffer, filename: `rapport-${type}-comparatif-${today}.pdf` };
  }

  // ── School info ──────────────────────────────────────────────────────────

  private async getSchoolInfo(tenantId: string): Promise<SchoolInfo> {
    const [config, tenant] = await Promise.all([
      this.prisma.ecoleConfig.findUnique({ where: { tenantId } }),
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { nom: true, adresse: true, telephone: true, emailContact: true, logoUrl: true },
      }),
    ]);

    const schoolName = config?.nom ?? tenant?.nom ?? 'Noura School';
    const logoKey = config?.logoUrl ?? tenant?.logoUrl ?? null;

    let logoUrl: string | null = null;
    if (logoKey) {
      try {
        const buf = await this.storage.getPrivateBuffer(this.storageKey(logoKey) ?? '');
        if (buf?.length) {
          logoUrl = `data:${this.imageMimeType(buf)};base64,${buf.toString('base64')}`;
        }
      } catch {
        logoUrl = this.storage.resolveUrl(logoKey) ?? null;
      }
    }

    return {
      name: schoolName,
      address: [config?.adresse ?? tenant?.adresse, config?.ville].filter(Boolean).join(' — '),
      phone: config?.telephone ?? tenant?.telephone ?? '',
      email: config?.email ?? tenant?.emailContact ?? '',
      logoUrl,
      primaryColor: this.validColor(config?.primaryColor) ?? '#2563eb',
    };
  }

  // ── Year resolution ─────────────────────────────────────────────────────

  private async resolveYears(tenantId: string, params: RapportParams): Promise<ResolvedYear[]> {
    if (params.anneeIds) {
      const ids = params.anneeIds.split(',').map((s) => s.trim()).filter(Boolean);
      return this.prisma.anneeAcademique.findMany({
        where: { tenantId, id: { in: ids } },
        orderBy: { dateDebut: 'asc' },
        select: { id: true, libelle: true, dateDebut: true, dateFin: true },
      });
    }
    if (params.annees) {
      if (params.annees === '*') {
        return this.prisma.anneeAcademique.findMany({
          where: { tenantId },
          orderBy: { dateDebut: 'asc' },
          select: { id: true, libelle: true, dateDebut: true, dateFin: true },
        });
      }
      const libelles = params.annees.split(',').map((s) => s.trim()).filter(Boolean);
      if (libelles.length === 1) {
        // Single year via annees param → treat as single (no comparison)
        const found = await this.prisma.anneeAcademique.findFirst({
          where: { tenantId, libelle: libelles[0] },
          select: { id: true, libelle: true, dateDebut: true, dateFin: true },
        });
        return found ? [found] : [];
      }
      return this.prisma.anneeAcademique.findMany({
        where: { tenantId, libelle: { in: libelles } },
        orderBy: { dateDebut: 'asc' },
        select: { id: true, libelle: true, dateDebut: true, dateFin: true },
      });
    }
    // No multi-year param → empty = use existing single-year params as-is
    return [];
  }

  private buildYearParams(type: RapportType, year: ResolvedYear, baseParams: RapportParams): RapportParams {
    const p: RapportParams = { ...baseParams, annees: undefined, anneeIds: undefined };
    switch (type) {
      case 'bulletins':
      case 'paiements':
        p.anneeScolaire = year.libelle;
        break;
      case 'inscriptions':
        p.anneeId = year.id;
        break;
      case 'emplois-du-temps':
        p.anneeScolaire = year.libelle;
        break;
      case 'absences-eleves':
      case 'pointages':
      case 'communications':
      case 'audit':
        p.dateFrom = year.dateDebut.toISOString().slice(0, 10);
        p.dateTo = year.dateFin?.toISOString().slice(0, 10) ?? new Date().toISOString().slice(0, 10);
        break;
    }
    return p;
  }

  // ── Data fetchers ────────────────────────────────────────────────────────

  private async fetchData(tenantId: string, type: RapportType, params: RapportParams): Promise<ReportData> {
    const limit = Math.min(Number(params.limit ?? 500), 1000);
    switch (type) {
      case 'bulletins': return this.fetchBulletins(tenantId, params, limit);
      case 'absences-eleves': return this.fetchAbsences(tenantId, params, limit);
      case 'paiements': return this.fetchPaiements(tenantId, params, limit);
      case 'inscriptions': return this.fetchInscriptions(tenantId, params, limit);
      case 'pointages': return this.fetchPointages(tenantId, params, limit);
      case 'emplois-du-temps': return this.fetchEmplois(tenantId, params, limit);
      case 'communications': return this.fetchCommunications(tenantId, params, limit);
      case 'audit': return this.fetchAudit(tenantId, params, limit);
    }
  }

  // R1 — Bulletins
  private async fetchBulletins(tenantId: string, params: RapportParams, limit: number): Promise<ReportData> {
    const where: Record<string, unknown> = { tenantId };
    if (params.anneeScolaire) where.anneeScolaire = params.anneeScolaire;
    if (params.trimestre) where.trimestre = params.trimestre;
    if (params.classeId) where.classeId = params.classeId;
    if (params.statut) where.statut = params.statut;

    const bulletins = await this.prisma.bulletin.findMany({
      where,
      orderBy: [{ anneeScolaire: 'desc' }, { classe: { nom: 'asc' } }, { moyenne: 'desc' }],
      take: limit,
      include: {
        classe: { select: { nom: true } },
      },
    });

    const eleveIds = [...new Set(bulletins.map((b) => b.eleveId))];
    const eleves = await this.prisma.user.findMany({
      where: { id: { in: eleveIds }, tenantId },
      select: { id: true, firstName: true, lastName: true, matricule: true },
    });
    const eleveMap = new Map(eleves.map((e) => [e.id, e]));

    const rows = bulletins.map((b) => {
      const eleve = eleveMap.get(b.eleveId);
      const nom = eleve ? `${eleve.firstName} ${eleve.lastName}`.trim() : '—';
      const moy = b.moyenne !== null ? `${Number(b.moyenne).toFixed(2)}/20` : '—';
      const rang = b.rang ? `${b.rang}${b.totalEleves ? `/${b.totalEleves}` : ''}` : '—';
      return [
        nom,
        eleve?.matricule ?? '—',
        b.classe?.nom ?? '—',
        this.periodLabel(b.trimestre),
        b.anneeScolaire,
        moy,
        rang,
        this.statutLabel(b.statut),
      ];
    });

    const paramsText = [
      params.anneeScolaire && `Année: ${params.anneeScolaire}`,
      params.trimestre && `Période: ${this.periodLabel(params.trimestre)}`,
      params.statut && `Statut: ${this.statutLabel(params.statut)}`,
    ].filter(Boolean).join(' · ') || 'Tous les bulletins';

    const validated = bulletins.filter((b) => b.statut === 'VALIDE').length;
    const brouillons = bulletins.filter((b) => b.statut === 'BROUILLON').length;
    const withMoyenne = bulletins.filter((b) => b.moyenne !== null);
    const avgMoy = withMoyenne.length ? withMoyenne.reduce((s, b) => s + Number(b.moyenne), 0) / withMoyenne.length : 0;
    const above10 = withMoyenne.filter((b) => Number(b.moyenne) >= 10).length;
    const tauxReussite = withMoyenne.length ? Math.round((above10 / withMoyenne.length) * 100) : 0;
    const maxMoy = withMoyenne.length ? Math.max(...withMoyenne.map((b) => Number(b.moyenne))) : 0;
    const minMoy = withMoyenne.length ? Math.min(...withMoyenne.map((b) => Number(b.moyenne))) : 0;

    // Classes with most bulletins
    const classeCount = new Map<string, number>();
    bulletins.forEach((b) => {
      const cn = b.classe?.nom ?? '—';
      classeCount.set(cn, (classeCount.get(cn) ?? 0) + 1);
    });

    return {
      title: RAPPORT_TITLES['bulletins'],
      subtitle: `${bulletins.length} bulletin(s) · ${validated} validé(s)`,
      paramsText,
      headers: ['Élève', 'Matricule', 'Classe', 'Période', 'Année', 'Moyenne', 'Rang', 'Statut'],
      rows,
      totalLabel: `Total : ${bulletins.length} bulletin(s)`,
      analysis: [
        {
          title: 'Synthèse académique',
          items: [
            { label: 'Moyenne générale', value: avgMoy ? `${avgMoy.toFixed(2)}/20` : '—', color: avgMoy >= 10 ? '#16a34a' : '#dc2626', highlight: true },
            { label: 'Taux de réussite (≥10/20)', value: `${tauxReussite}%`, color: tauxReussite >= 50 ? '#16a34a' : '#dc2626', highlight: true },
            { label: 'Meilleure moyenne', value: maxMoy ? `${maxMoy.toFixed(2)}/20` : '—', color: '#16a34a' },
            { label: 'Plus faible moyenne', value: minMoy ? `${minMoy.toFixed(2)}/20` : '—', color: minMoy >= 10 ? '#16a34a' : '#dc2626' },
          ],
        },
        {
          title: 'Statut des bulletins',
          items: [
            { label: 'Validés', value: String(validated), color: '#16a34a' },
            { label: 'Brouillons', value: String(brouillons), color: brouillons > 0 ? '#d97706' : '#64748b' },
            { label: 'Classes concernées', value: String(classeCount.size) },
            { label: 'Élèves distincts', value: String(new Set(bulletins.map((b) => b.eleveId)).size) },
          ],
        },
      ],
    };
  }

  // R2 — Absences élèves
  private async fetchAbsences(tenantId: string, params: RapportParams, limit: number): Promise<ReportData> {
    const where: Record<string, unknown> = { tenantId };
    if (params.classeId) where.classeId = params.classeId;
    if (params.statut) where.statut = params.statut;
    if (params.dateFrom || params.dateTo) {
      const gte = params.dateFrom ? new Date(params.dateFrom) : undefined;
      const lte = params.dateTo ? new Date(params.dateTo) : undefined;
      where.date = { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
    }

    const absences = await this.prisma.absenceEleve.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      include: {
        classe: { select: { nom: true } },
      },
    });

    const eleveIds = [...new Set(absences.map((a) => a.eleveId))];
    const eleves = await this.prisma.user.findMany({
      where: { id: { in: eleveIds }, tenantId },
      select: { id: true, firstName: true, lastName: true },
    });
    const eleveMap = new Map(eleves.map((e) => [e.id, e]));

    const rows = absences.map((a) => {
      const eleve = eleveMap.get(a.eleveId);
      const nom = eleve ? `${eleve.firstName} ${eleve.lastName}`.trim() : '—';
      return [
        nom,
        a.classe?.nom ?? '—',
        this.formatDate(a.date),
        a.typeAbsence === 'RETARD' ? 'Retard' : 'Absence',
        a.justifiee ? 'Oui' : 'Non',
        a.statut,
        a.motif ?? '—',
      ];
    });

    const justifiees = absences.filter((a) => a.justifiee).length;
    const retards = absences.filter((a) => a.typeAbsence === 'RETARD').length;

    const paramsText = [
      params.dateFrom && `Du: ${params.dateFrom}`,
      params.dateTo && `Au: ${params.dateTo}`,
      params.statut && `Statut: ${params.statut}`,
    ].filter(Boolean).join(' · ') || 'Toutes les absences';

    const nonJustifiees = absences.length - justifiees;
    const tauxJustif = absences.length ? Math.round((justifiees / absences.length) * 100) : 0;
    const elevesDistincts = new Set(absences.map((a) => a.eleveId)).size;

    // Top classes par absences
    const classeAbsCount = new Map<string, number>();
    absences.forEach((a) => {
      const cn = a.classe?.nom ?? '—';
      classeAbsCount.set(cn, (classeAbsCount.get(cn) ?? 0) + 1);
    });
    const topClasse = [...classeAbsCount.entries()].sort((a, b) => b[1] - a[1])[0];

    return {
      title: RAPPORT_TITLES['absences-eleves'],
      subtitle: `${absences.length} absence(s) · ${justifiees} justifiée(s) · ${retards} retard(s)`,
      paramsText,
      headers: ['Élève', 'Classe', 'Date', 'Type', 'Justifiée', 'Statut', 'Motif'],
      rows,
      totalLabel: `Total : ${absences.length} entrée(s)`,
      analysis: [
        {
          title: 'Bilan des absences',
          items: [
            { label: 'Absences', value: String(absences.length - retards), color: '#dc2626', highlight: true },
            { label: 'Retards', value: String(retards), color: '#d97706', highlight: true },
            { label: 'Taux de justification', value: `${tauxJustif}%`, color: tauxJustif >= 50 ? '#16a34a' : '#dc2626', highlight: true },
            { label: 'Non justifiées', value: String(nonJustifiees), color: nonJustifiees > 0 ? '#dc2626' : '#16a34a' },
          ],
        },
        {
          title: 'Répartition',
          items: [
            { label: 'Élèves concernés', value: String(elevesDistincts) },
            { label: 'Classes touchées', value: String(classeAbsCount.size) },
            { label: 'Classe la plus touchée', value: topClasse ? `${topClasse[0]} (${topClasse[1]})` : '—', color: '#dc2626' },
            { label: 'Moy. par élève', value: elevesDistincts ? (absences.length / elevesDistincts).toFixed(1) : '—' },
          ],
        },
      ],
    };
  }

  // R3 — Paiements
  private async fetchPaiements(tenantId: string, params: RapportParams, limit: number): Promise<ReportData> {
    const where: Record<string, unknown> = { tenantId };
    if (params.anneeScolaire) where.anneeScolaire = params.anneeScolaire;
    if (params.statut) where.statut = params.statut;
    if (params.dateFrom || params.dateTo) {
      const gte = params.dateFrom ? new Date(params.dateFrom) : undefined;
      const lte = params.dateTo ? new Date(params.dateTo) : undefined;
      where.datePaiement = { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
    }

    const paiements = await this.prisma.paiement.findMany({
      where,
      orderBy: { datePaiement: 'desc' },
      take: limit,
    });

    const eleveIds = [...new Set(paiements.map((p) => p.eleveId))];
    const eleves = await this.prisma.user.findMany({
      where: { id: { in: eleveIds }, tenantId },
      select: { id: true, firstName: true, lastName: true, matricule: true },
    });
    const eleveMap = new Map(eleves.map((e) => [e.id, e]));

    const rows = paiements.map((p) => {
      const eleve = eleveMap.get(p.eleveId);
      const nom = eleve ? `${eleve.firstName} ${eleve.lastName}`.trim() : '—';
      return [
        p.reference,
        nom,
        eleve?.matricule ?? '—',
        this.formatFcfa(p.montant),
        this.paymentTypeLabel(p.typePaiement),
        this.modeLabel(p.modePaiement),
        p.statut,
        p.datePaiement ? this.formatDate(p.datePaiement) : '—',
        p.anneeScolaire,
      ];
    });

    const totalValide = paiements.filter((p) => p.statut === 'VALIDE').reduce((s, p) => s + Number(p.montant), 0);
    const totalEnAttente = paiements.filter((p) => p.statut === 'EN_ATTENTE').reduce((s, p) => s + Number(p.montant), 0);

    const paramsText = [
      params.anneeScolaire && `Année: ${params.anneeScolaire}`,
      params.statut && `Statut: ${params.statut}`,
      params.dateFrom && `Du: ${params.dateFrom}`,
      params.dateTo && `Au: ${params.dateTo}`,
    ].filter(Boolean).join(' · ') || 'Tous les paiements';

    const totalGlobal = totalValide + totalEnAttente;
    const tauxRecouvrement = totalGlobal > 0 ? Math.round((totalValide / totalGlobal) * 100) : 0;
    const rejetes = paiements.filter((p) => !['VALIDE', 'EN_ATTENTE'].includes(p.statut)).length;

    // Répartition par mode de paiement
    const modeCount = new Map<string, number>();
    paiements.forEach((p) => {
      const mode = this.modeLabel(p.modePaiement);
      modeCount.set(mode, (modeCount.get(mode) ?? 0) + 1);
    });
    const topMode = [...modeCount.entries()].sort((a, b) => b[1] - a[1])[0];

    return {
      title: RAPPORT_TITLES['paiements'],
      subtitle: `${paiements.length} transaction(s) · Encaissé: ${this.formatFcfa(totalValide)} · En attente: ${this.formatFcfa(totalEnAttente)}`,
      paramsText,
      headers: ['Référence', 'Élève', 'Matricule', 'Montant', 'Type', 'Mode', 'Statut', 'Date', 'Année'],
      rows,
      totalLabel: `Total encaissé : ${this.formatFcfa(totalValide)}`,
      analysis: [
        {
          title: 'Bilan financier',
          items: [
            { label: 'Total encaissé', value: this.formatFcfa(totalValide), color: '#16a34a', highlight: true },
            { label: 'En attente', value: this.formatFcfa(totalEnAttente), color: '#d97706', highlight: true },
            { label: 'Taux de recouvrement', value: `${tauxRecouvrement}%`, color: tauxRecouvrement >= 75 ? '#16a34a' : tauxRecouvrement >= 50 ? '#d97706' : '#dc2626', highlight: true },
            { label: 'Montant global', value: this.formatFcfa(totalGlobal) },
          ],
        },
        {
          title: 'Détails',
          items: [
            { label: 'Paiements validés', value: String(paiements.filter((p) => p.statut === 'VALIDE').length), color: '#16a34a' },
            { label: 'Paiements en attente', value: String(paiements.filter((p) => p.statut === 'EN_ATTENTE').length), color: '#d97706' },
            { label: 'Rejetés / Annulés', value: String(rejetes), color: rejetes > 0 ? '#dc2626' : '#64748b' },
            { label: 'Mode principal', value: topMode ? `${topMode[0]} (${topMode[1]})` : '—' },
          ],
        },
      ],
    };
  }

  // R4 — Inscriptions
  private async fetchInscriptions(tenantId: string, params: RapportParams, limit: number): Promise<ReportData> {
    const where: Record<string, unknown> = { tenantId };
    if (params.statut) where.statut = params.statut;
    if (params.classeId) where.classeId = params.classeId;
    if (params.anneeId) where.anneeAcademiqueId = params.anneeId;

    const inscriptions = await this.prisma.inscription.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take: limit,
      include: {
        classe: { select: { nom: true, niveau: { select: { libelle: true, cycle: { select: { libelle: true } } } } } },
        anneeAcademique: { select: { libelle: true } },
      },
    });

    const eleveIds = [...new Set(inscriptions.map((i) => i.eleveId))];
    const eleves = await this.prisma.user.findMany({
      where: { id: { in: eleveIds }, tenantId },
      select: { id: true, firstName: true, lastName: true, matricule: true, genre: true },
    });
    const eleveMap = new Map(eleves.map((e) => [e.id, e]));

    const rows = inscriptions.map((ins) => {
      const eleve = eleveMap.get(ins.eleveId);
      const nom = eleve ? `${eleve.firstName} ${eleve.lastName}`.trim() : '—';
      const genre = eleve?.genre === 'M' ? 'M' : eleve?.genre === 'F' ? 'F' : '—';
      return [
        ins.numeroInscription,
        nom,
        eleve?.matricule ?? '—',
        genre,
        ins.classe?.nom ?? '—',
        ins.classe?.niveau?.libelle ?? '—',
        ins.classe?.niveau?.cycle?.libelle ?? '—',
        ins.anneeAcademique?.libelle ?? '—',
        ins.statut,
        ins.fraisInscription ? this.formatFcfa(ins.fraisInscription) : '—',
        this.formatDate(ins.createdAt),
      ];
    });

    const actives = inscriptions.filter((i) => i.statut === 'ACTIF').length;
    const inactives = inscriptions.filter((i) => i.statut === 'INACTIF').length;
    const totalFrais = inscriptions.reduce((s, i) => s + Number(i.fraisInscription ?? 0), 0);

    // Genre
    const filles = inscriptions.filter((i) => eleveMap.get(i.eleveId)?.genre === 'F').length;
    const garcons = inscriptions.filter((i) => eleveMap.get(i.eleveId)?.genre === 'M').length;

    // Répartition par cycle
    const cycleCount = new Map<string, number>();
    inscriptions.forEach((i) => {
      const cycle = i.classe?.niveau?.cycle?.libelle ?? '—';
      cycleCount.set(cycle, (cycleCount.get(cycle) ?? 0) + 1);
    });

    const paramsText = [
      params.anneeId && 'Année filtrée',
      params.statut && `Statut: ${params.statut}`,
    ].filter(Boolean).join(' · ') || 'Toutes les inscriptions';

    return {
      title: RAPPORT_TITLES['inscriptions'],
      subtitle: `${inscriptions.length} inscription(s) · ${actives} active(s)`,
      paramsText,
      headers: ['N° Inscr.', 'Élève', 'Matricule', 'Genre', 'Classe', 'Niveau', 'Cycle', 'Année', 'Statut', 'Frais', 'Date'],
      rows,
      totalLabel: `Total : ${inscriptions.length} inscription(s) dont ${actives} active(s)`,
      analysis: [
        {
          title: 'Effectifs',
          items: [
            { label: 'Inscriptions actives', value: String(actives), color: '#16a34a', highlight: true },
            { label: 'Inscriptions inactives', value: String(inactives), color: inactives > 0 ? '#dc2626' : '#64748b' },
            { label: 'Filles', value: String(filles), color: '#ec4899' },
            { label: 'Garçons', value: String(garcons), color: '#2563eb' },
          ],
        },
        {
          title: 'Répartition & Frais',
          items: [
            { label: 'Total frais d\'inscription', value: this.formatFcfa(totalFrais), highlight: true },
            { label: 'Classes distinctes', value: String(new Set(inscriptions.map((i) => i.classeId)).size) },
            ...[...cycleCount.entries()].slice(0, 2).map(([cycle, nb]) => ({
              label: cycle, value: String(nb),
            })),
          ],
        },
      ],
    };
  }

  // R5 — Pointages personnel
  private async fetchPointages(tenantId: string, params: RapportParams, limit: number): Promise<ReportData> {
    const where: Record<string, unknown> = { tenantId };
    if (params.dateFrom || params.dateTo) {
      const gte = params.dateFrom ? new Date(params.dateFrom) : undefined;
      const lte = params.dateTo ? new Date(params.dateTo) : undefined;
      where.dateHeure = { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
    }

    const pointages = await this.prisma.pointage.findMany({
      where,
      orderBy: { dateHeure: 'desc' },
      take: limit,
      include: {
        personnel: {
          include: {
            utilisateur: { select: { firstName: true, lastName: true, role: true } },
          },
        },
      },
    });

    const rows = pointages.map((p) => {
      const nom = p.personnel?.utilisateur
        ? `${p.personnel.utilisateur.firstName} ${p.personnel.utilisateur.lastName}`.trim()
        : '—';
      const role = p.personnel?.utilisateur?.role ?? '—';
      return [
        nom,
        role,
        this.formatDate(p.dateHeure),
        p.heureArrivee ?? '—',
        p.heureDepart ?? '—',
        p.statut ?? '—',
        p.methode ?? '—',
        p.observations ?? '—',
      ];
    });

    const paramsText = [
      params.dateFrom && `Du: ${params.dateFrom}`,
      params.dateTo && `Au: ${params.dateTo}`,
    ].filter(Boolean).join(' · ') || 'Tous les pointages';

    const presents = pointages.filter((p) => p.statut === 'PRESENT').length;
    const absents = pointages.filter((p) => p.statut === 'ABSENT').length;
    const enRetard = pointages.filter((p) => p.statut === 'RETARD').length;
    const tauxPresence = pointages.length ? Math.round((presents / pointages.length) * 100) : 0;
    const personnelDistinct = new Set(pointages.map((p) => p.personnel?.utilisateur ? `${p.personnel.utilisateur.firstName} ${p.personnel.utilisateur.lastName}` : p.personnelId)).size;

    return {
      title: RAPPORT_TITLES['pointages'],
      subtitle: `${pointages.length} pointage(s)`,
      paramsText,
      headers: ['Personnel', 'Rôle', 'Date', 'Heure arrivée', 'Heure départ', 'Statut', 'Méthode', 'Observations'],
      rows,
      totalLabel: `Total : ${pointages.length} pointage(s)`,
      analysis: [
        {
          title: 'Bilan de présence',
          items: [
            { label: 'Taux de présence', value: `${tauxPresence}%`, color: tauxPresence >= 80 ? '#16a34a' : tauxPresence >= 60 ? '#d97706' : '#dc2626', highlight: true },
            { label: 'Présents', value: String(presents), color: '#16a34a' },
            { label: 'Absents', value: String(absents), color: absents > 0 ? '#dc2626' : '#64748b' },
            { label: 'En retard', value: String(enRetard), color: enRetard > 0 ? '#d97706' : '#64748b' },
          ],
        },
        {
          title: 'Détails',
          items: [
            { label: 'Personnel suivi', value: String(personnelDistinct) },
            { label: 'Jours couverts', value: String(new Set(pointages.map((p) => this.formatDate(p.dateHeure))).size) },
          ],
        },
      ],
    };
  }

  // R6 — Emplois du temps
  private async fetchEmplois(tenantId: string, params: RapportParams, limit: number): Promise<ReportData> {
    const where: Record<string, unknown> = { tenantId };
    if (params.classeId) where.classeId = params.classeId;
    if (params.anneeScolaire) where.anneeScolaire = params.anneeScolaire;

    const emplois = await this.prisma.emploiDuTemps.findMany({
      where,
      orderBy: [{ classe: { nom: 'asc' } }, { jourSemaine: 'asc' }, { heureDebut: 'asc' }],
      take: limit,
      include: {
        classe: { select: { nom: true } },
        cours: { include: { matiere: { select: { libelle: true } } } },
        salle: { select: { nom: true } },
      },
    });

    // Bulk-fetch enseignant names
    const enseignantIds = [...new Set(emplois.map((e) => e.enseignantId).filter((id): id is string => !!id))];
    const enseignants = enseignantIds.length
      ? await this.prisma.user.findMany({
        where: { id: { in: enseignantIds }, tenantId },
        select: { id: true, firstName: true, lastName: true },
      })
      : [];
    const enseignantMap = new Map(enseignants.map((e) => [e.id, e]));

    // Bulk-fetch matiere names for slots without cours
    const matiereIds = [...new Set(emplois.filter((e) => e.matiereId && !e.cours).map((e) => e.matiereId as string))];
    const matieres = matiereIds.length
      ? await this.prisma.matiere.findMany({ where: { id: { in: matiereIds } }, select: { id: true, libelle: true } })
      : [];
    const matiereMap = new Map(matieres.map((m) => [m.id, m]));

    const rows = emplois.map((emp) => {
      const enseignant = emp.enseignantId ? enseignantMap.get(emp.enseignantId) : null;
      const enseignantNom = enseignant ? `${enseignant.firstName} ${enseignant.lastName}`.trim() : '—';
      const matiereLibelle = emp.cours?.matiere?.libelle ?? (emp.matiereId ? (matiereMap.get(emp.matiereId)?.libelle ?? '—') : '—');
      return [
        emp.classe?.nom ?? '—',
        this.jourLabel(emp.jourSemaine),
        emp.heureDebut,
        emp.heureFin,
        matiereLibelle,
        enseignantNom,
        emp.salle?.nom ?? '—',
        emp.publie ? 'Publié' : 'Brouillon',
      ];
    });

    const paramsText = params.classeId ? 'Classe filtrée' : 'Tous les emplois du temps';

    const publies = emplois.filter((e) => e.publie).length;
    const brouillonsEdt = emplois.length - publies;
    const classesDistinctes = new Set(emplois.map((e) => e.classe?.nom)).size;
    const enseignantsDistincts = new Set(emplois.map((e) => e.enseignantId).filter(Boolean)).size;

    // Répartition par jour
    const jourCount = new Map<string, number>();
    emplois.forEach((e) => {
      const jour = this.jourLabel(e.jourSemaine);
      jourCount.set(jour, (jourCount.get(jour) ?? 0) + 1);
    });
    const jourMax = [...jourCount.entries()].sort((a, b) => b[1] - a[1])[0];

    return {
      title: RAPPORT_TITLES['emplois-du-temps'],
      subtitle: `${emplois.length} créneau(x)`,
      paramsText,
      headers: ['Classe', 'Jour', 'Début', 'Fin', 'Matière', 'Enseignant', 'Salle', 'Statut'],
      rows,
      totalLabel: `Total : ${emplois.length} créneau(x)`,
      analysis: [
        {
          title: 'Organisation',
          items: [
            { label: 'Créneaux publiés', value: String(publies), color: '#16a34a', highlight: true },
            { label: 'Brouillons', value: String(brouillonsEdt), color: brouillonsEdt > 0 ? '#d97706' : '#64748b' },
            { label: 'Classes planifiées', value: String(classesDistinctes) },
            { label: 'Enseignants mobilisés', value: String(enseignantsDistincts) },
          ],
        },
        {
          title: 'Répartition',
          items: [
            { label: 'Jour le plus chargé', value: jourMax ? `${jourMax[0]} (${jourMax[1]} créneaux)` : '—' },
            { label: 'Salles utilisées', value: String(new Set(emplois.map((e) => e.salle?.nom).filter(Boolean)).size) },
          ],
        },
      ],
    };
  }

  // R7 — Communications (uses $queryRaw because the Communication Prisma model is not yet in the generated client)
  private async fetchCommunications(tenantId: string, params: RapportParams, limit: number): Promise<ReportData> {
    type CommRow = {
      id: string;
      titre: string;
      canal: string;
      statut: string;
      cible: string | null;
      cibleType: string;
      auteurId: string | null;
      nbDestinataires: number;
      nbLus: number;
      envoyeLe: Date | null;
      createdAt: Date;
    };

    const whereClauses = [Prisma.sql`"tenantId" = ${tenantId}::uuid`];
    if (params.statut) whereClauses.push(Prisma.sql`statut = ${params.statut}`);

    const comms = await this.prisma.$queryRaw<CommRow[]>`
      SELECT id, titre, canal, statut, cible, "cibleType", "auteurId",
             "nbDestinataires", "nbLus", "envoyeLe", "createdAt"
      FROM "communications"
      WHERE ${Prisma.join(whereClauses, ' AND ')}
      ORDER BY "createdAt" DESC
      LIMIT ${limit}
    `;

    // Bulk-fetch auteur names
    const auteurIds = [...new Set(comms.map((c) => c.auteurId).filter((id): id is string => !!id))];
    const auteurs = auteurIds.length
      ? await this.prisma.user.findMany({
        where: { id: { in: auteurIds }, tenantId },
        select: { id: true, firstName: true, lastName: true },
      })
      : [];
    const auteurMap = new Map(auteurs.map((a) => [a.id, a]));

    const tableRows = comms.map((c) => {
      const auteur = c.auteurId ? auteurMap.get(c.auteurId) : null;
      const auteurNom = auteur ? `${auteur.firstName} ${auteur.lastName}`.trim() : '—';
      return [
        c.titre,
        c.canal,
        c.statut,
        c.cible ?? c.cibleType,
        auteurNom,
        String(c.nbDestinataires),
        String(c.nbLus),
        c.envoyeLe ? this.formatDate(c.envoyeLe) : '—',
        this.formatDate(c.createdAt),
      ];
    });

    const paramsText = params.statut ? `Statut: ${params.statut}` : 'Toutes les communications';
    const envoyes = comms.filter((c) => c.statut === 'ENVOYE').length;
    const brouillonsComm = comms.filter((c) => c.statut === 'BROUILLON').length;
    const totalDest = comms.reduce((s, c) => s + (c.nbDestinataires ?? 0), 0);
    const totalLus = comms.reduce((s, c) => s + (c.nbLus ?? 0), 0);
    const tauxLecture = totalDest > 0 ? Math.round((totalLus / totalDest) * 100) : 0;

    // Répartition par canal
    const canalCount = new Map<string, number>();
    comms.forEach((c) => {
      canalCount.set(c.canal, (canalCount.get(c.canal) ?? 0) + 1);
    });

    return {
      title: RAPPORT_TITLES['communications'],
      subtitle: `${comms.length} message(s) · ${envoyes} envoyé(s)`,
      paramsText,
      headers: ['Titre', 'Canal', 'Statut', 'Cible', 'Auteur', 'Destinataires', 'Lus', 'Envoyé le', 'Créé le'],
      rows: tableRows,
      totalLabel: `Total : ${comms.length} communication(s)`,
      analysis: [
        {
          title: 'Bilan de diffusion',
          items: [
            { label: 'Messages envoyés', value: String(envoyes), color: '#16a34a', highlight: true },
            { label: 'Brouillons', value: String(brouillonsComm), color: brouillonsComm > 0 ? '#d97706' : '#64748b' },
            { label: 'Taux de lecture', value: `${tauxLecture}%`, color: tauxLecture >= 50 ? '#16a34a' : '#d97706', highlight: true },
            { label: 'Total destinataires', value: String(totalDest) },
          ],
        },
        {
          title: 'Canaux',
          items: [...canalCount.entries()].map(([canal, nb]) => ({
            label: canal, value: String(nb),
          })),
        },
      ],
    };
  }

  // R8 — Audit
  private async fetchAudit(tenantId: string, params: RapportParams, limit: number): Promise<ReportData> {
    const where: Record<string, unknown> = { tenantId };
    if (params.dateFrom || params.dateTo) {
      const gte = params.dateFrom ? new Date(params.dateFrom) : undefined;
      const lte = params.dateTo ? new Date(params.dateTo) : undefined;
      where.createdAt = { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
    }

    const logs = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        utilisateur: { select: { firstName: true, lastName: true, role: true } },
      },
    });

    const rows = logs.map((l) => {
      const user = l.utilisateur;
      const nom = user ? `${user.firstName} ${user.lastName}`.trim() : '—';
      const role = user?.role ?? l.role ?? '—';
      const details = l.details ? JSON.stringify(l.details).slice(0, 80) : '—';
      return [
        this.formatDateTime(l.createdAt),
        l.action,
        nom,
        role,
        l.resourceType ?? '—',
        l.resourceId?.slice(0, 8) ?? '—',
        details,
        l.ipAddress ?? '—',
      ];
    });

    const paramsText = [
      params.dateFrom && `Du: ${params.dateFrom}`,
      params.dateTo && `Au: ${params.dateTo}`,
    ].filter(Boolean).join(' · ') || 'Journal complet';

    // Répartition par action
    const actionCount = new Map<string, number>();
    logs.forEach((l) => {
      actionCount.set(l.action, (actionCount.get(l.action) ?? 0) + 1);
    });
    const topActions = [...actionCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

    // Utilisateurs distincts
    const usersDistincts = new Set(logs.map((l) => l.utilisateurId).filter(Boolean)).size;

    // Répartition par rôle
    const roleCount = new Map<string, number>();
    logs.forEach((l) => {
      const role = l.utilisateur?.role ?? l.role ?? '—';
      roleCount.set(role, (roleCount.get(role) ?? 0) + 1);
    });

    return {
      title: RAPPORT_TITLES['audit'],
      subtitle: `${logs.length} entrée(s)`,
      paramsText,
      headers: ['Date / Heure', 'Action', 'Utilisateur', 'Rôle', 'Ressource', 'ID', 'Détails', 'IP'],
      rows,
      totalLabel: `Total : ${logs.length} action(s) auditée(s)`,
      analysis: [
        {
          title: 'Activité',
          items: [
            { label: 'Actions enregistrées', value: String(logs.length), highlight: true },
            { label: 'Utilisateurs actifs', value: String(usersDistincts) },
            { label: 'Types d\'actions', value: String(actionCount.size) },
            { label: 'Adresses IP uniques', value: String(new Set(logs.map((l) => l.ipAddress).filter(Boolean)).size) },
          ],
        },
        {
          title: 'Actions les plus fréquentes',
          items: topActions.map(([action, nb]) => ({
            label: action, value: String(nb),
          })),
        },
      ],
    };
  }

  // ── Comparative report builder ──────────────────────────────────────────

  private buildComparativeReport(
    type: RapportType,
    yearLabels: string[],
    yearDataMap: Map<string, ReportData>,
  ): ComparativeReportData {
    const title = RAPPORT_TITLES[type];
    const subtitle = `Analyse comparative — ${yearLabels.join(' / ')}`;

    // Extract evolution rows from analysis sections
    const evolutionRows = this.extractEvolutionRows(type, yearLabels, yearDataMap);

    // Build combined table: add "Année" column to all rows
    const firstData = yearDataMap.values().next().value;
    const baseHeaders = firstData?.headers ?? [];
    const combinedHeaders = ['Année', ...baseHeaders];

    const maxRowsPerYear = Math.min(100, Math.floor(500 / yearLabels.length));
    const combinedRows: string[][] = [];
    for (const year of yearLabels) {
      const data = yearDataMap.get(year);
      if (!data) continue;
      const rows = data.rows.slice(0, maxRowsPerYear);
      for (const row of rows) {
        combinedRows.push([year, ...row]);
      }
    }

    const totalRows = [...yearDataMap.values()].reduce((s, d) => s + d.rows.length, 0);

    return {
      title,
      subtitle,
      years: yearLabels,
      evolutionRows,
      combinedHeaders,
      combinedRows,
      totalLabel: `Total : ${totalRows} entrée(s) sur ${yearLabels.length} année(s)`,
    };
  }

  private extractEvolutionRows(
    type: RapportType,
    yearLabels: string[],
    yearDataMap: Map<string, ReportData>,
  ): EvolutionRow[] {
    // Define which metrics to extract per report type
    const metricDefs = this.getMetricDefs(type);

    return metricDefs.map((def) => {
      const values = new Map<string, string>();
      const numValues = new Map<string, number>();

      for (const year of yearLabels) {
        const data = yearDataMap.get(year);
        if (!data?.analysis) {
          values.set(year, '—');
          numValues.set(year, 0);
          continue;
        }
        const extracted = this.extractMetricFromAnalysis(data.analysis, def.sectionTitle, def.itemLabel);
        values.set(year, extracted.display);
        numValues.set(year, extracted.num);
      }

      return {
        label: def.label,
        values,
        numValues,
        unit: def.unit,
        higherIsBetter: def.higherIsBetter,
      };
    });
  }

  private getMetricDefs(type: RapportType): { label: string; sectionTitle: string; itemLabel: string; unit?: string; higherIsBetter?: boolean }[] {
    switch (type) {
      case 'bulletins':
        return [
          { label: 'Moyenne générale', sectionTitle: 'Synthèse académique', itemLabel: 'Moyenne générale', unit: '/20', higherIsBetter: true },
          { label: 'Taux de réussite', sectionTitle: 'Synthèse académique', itemLabel: 'Taux de réussite (≥10/20)', unit: '%', higherIsBetter: true },
          { label: 'Bulletins validés', sectionTitle: 'Statut des bulletins', itemLabel: 'Validés', higherIsBetter: true },
          { label: 'Élèves distincts', sectionTitle: 'Statut des bulletins', itemLabel: 'Élèves distincts', higherIsBetter: true },
        ];
      case 'absences-eleves':
        return [
          { label: 'Total absences', sectionTitle: 'Bilan des absences', itemLabel: 'Absences', higherIsBetter: false },
          { label: 'Retards', sectionTitle: 'Bilan des absences', itemLabel: 'Retards', higherIsBetter: false },
          { label: 'Taux de justification', sectionTitle: 'Bilan des absences', itemLabel: 'Taux de justification', unit: '%', higherIsBetter: true },
          { label: 'Élèves concernés', sectionTitle: 'Répartition', itemLabel: 'Élèves concernés', higherIsBetter: false },
        ];
      case 'paiements':
        return [
          { label: 'Total encaissé', sectionTitle: 'Bilan financier', itemLabel: 'Total encaissé', unit: ' FCFA', higherIsBetter: true },
          { label: 'En attente', sectionTitle: 'Bilan financier', itemLabel: 'En attente', unit: ' FCFA', higherIsBetter: false },
          { label: 'Taux de recouvrement', sectionTitle: 'Bilan financier', itemLabel: 'Taux de recouvrement', unit: '%', higherIsBetter: true },
          { label: 'Transactions validées', sectionTitle: 'Détails', itemLabel: 'Paiements validés', higherIsBetter: true },
        ];
      case 'inscriptions':
        return [
          { label: 'Inscriptions actives', sectionTitle: 'Effectifs', itemLabel: 'Inscriptions actives', higherIsBetter: true },
          { label: 'Filles', sectionTitle: 'Effectifs', itemLabel: 'Filles', higherIsBetter: undefined },
          { label: 'Garçons', sectionTitle: 'Effectifs', itemLabel: 'Garçons', higherIsBetter: undefined },
          { label: 'Total frais', sectionTitle: 'Répartition & Frais', itemLabel: 'Total frais d\'inscription', unit: ' FCFA', higherIsBetter: true },
        ];
      case 'pointages':
        return [
          { label: 'Taux de présence', sectionTitle: 'Bilan de présence', itemLabel: 'Taux de présence', unit: '%', higherIsBetter: true },
          { label: 'Présents', sectionTitle: 'Bilan de présence', itemLabel: 'Présents', higherIsBetter: true },
          { label: 'Absents', sectionTitle: 'Bilan de présence', itemLabel: 'Absents', higherIsBetter: false },
          { label: 'En retard', sectionTitle: 'Bilan de présence', itemLabel: 'En retard', higherIsBetter: false },
        ];
      case 'emplois-du-temps':
        return [
          { label: 'Créneaux publiés', sectionTitle: 'Organisation', itemLabel: 'Créneaux publiés', higherIsBetter: true },
          { label: 'Brouillons', sectionTitle: 'Organisation', itemLabel: 'Brouillons', higherIsBetter: false },
          { label: 'Classes planifiées', sectionTitle: 'Organisation', itemLabel: 'Classes planifiées', higherIsBetter: true },
          { label: 'Enseignants mobilisés', sectionTitle: 'Organisation', itemLabel: 'Enseignants mobilisés', higherIsBetter: true },
        ];
      case 'communications':
        return [
          { label: 'Messages envoyés', sectionTitle: 'Bilan de diffusion', itemLabel: 'Messages envoyés', higherIsBetter: true },
          { label: 'Taux de lecture', sectionTitle: 'Bilan de diffusion', itemLabel: 'Taux de lecture', unit: '%', higherIsBetter: true },
          { label: 'Total destinataires', sectionTitle: 'Bilan de diffusion', itemLabel: 'Total destinataires', higherIsBetter: true },
        ];
      case 'audit':
        return [
          { label: 'Actions enregistrées', sectionTitle: 'Activité', itemLabel: 'Actions enregistrées', higherIsBetter: undefined },
          { label: 'Utilisateurs actifs', sectionTitle: 'Activité', itemLabel: 'Utilisateurs actifs', higherIsBetter: true },
          { label: 'Types d\'actions', sectionTitle: 'Activité', itemLabel: 'Types d\'actions', higherIsBetter: undefined },
        ];
    }
  }

  private extractMetricFromAnalysis(
    analysis: AnalysisSection[],
    sectionTitle: string,
    itemLabel: string,
  ): { display: string; num: number } {
    const section = analysis.find((s) => s.title === sectionTitle);
    if (!section) return { display: '—', num: 0 };
    const item = section.items.find((i) => i.label === itemLabel);
    if (!item) return { display: '—', num: 0 };
    // Extract number from value string (e.g. "12.50/20" → 12.50, "85%" → 85, "1 500 FCFA" → 1500)
    const numStr = item.value.replace(/[^0-9.,\-]/g, '').replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(numStr) || 0;
    return { display: item.value, num };
  }

  private formatEvolution(current: number, previous: number, higherIsBetter?: boolean): { text: string; color: string } {
    if (previous === 0 && current === 0) return { text: '→ 0', color: '#64748b' };
    const delta = current - previous;
    const pct = previous !== 0 ? Math.round((delta / previous) * 100) : (current > 0 ? 100 : 0);
    const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
    const sign = delta > 0 ? '+' : '';
    const isGood = higherIsBetter === undefined ? undefined : (higherIsBetter ? delta > 0 : delta < 0);
    const color = isGood === undefined ? '#475569' : isGood ? '#16a34a' : delta === 0 ? '#64748b' : '#dc2626';
    return { text: `${arrow} ${sign}${pct}%`, color };
  }

  // ── HTML renderer ────────────────────────────────────────────────────────

  private renderHtml(school: SchoolInfo, data: ReportData): string {
    const c = school.primaryColor;
    const today = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

    const logoHtml = school.logoUrl
      ? `<img src="${this.esc(school.logoUrl)}" alt="logo" style="width:50px;height:50px;object-fit:contain;flex:none;">`
      : `<div style="width:50px;height:50px;background:${c};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:18px;flex:none;border-radius:6px;">${this.esc(school.name.slice(0, 2).toUpperCase())}</div>`;

    const contactParts = [school.address, school.phone, school.email].filter(Boolean);

    const thStyle = `background:#1e293b;color:#fff;padding:8px 10px;text-align:left;font-weight:600;font-size:8px;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;border-bottom:2px solid ${c};`;
    const ths = data.headers.map((h) => `<th style="${thStyle}">${this.esc(h)}</th>`).join('');

    const tableRows = data.rows.map((row, i) => {
      const bg = i % 2 === 0 ? '#fff' : '#f8fafc';
      const tds = row.map((cell) => `<td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;color:#334155;font-size:9px;word-break:break-word;vertical-align:top;">${this.esc(cell)}</td>`).join('');
      return `<tr style="background:${bg};">${tds}</tr>`;
    }).join('');

    const emptyRow = data.rows.length === 0
      ? `<tr><td colspan="${data.headers.length}" style="padding:40px;text-align:center;color:#94a3b8;font-size:11px;font-style:italic;">Aucune donnée disponible</td></tr>`
      : '';

    return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; background: #fff; color: #0f172a; }
  @page { size: A4 landscape; margin: 10mm 8mm 10mm 8mm; }
  table { border-collapse: collapse; width: 100%; table-layout: fixed; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  td, th { overflow: hidden; text-overflow: ellipsis; }
</style>
</head><body>

<!-- Header band -->
<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;background:#1e293b;color:#fff;margin-bottom:0;">
  <div style="display:flex;align-items:center;gap:14px;flex:1;min-width:0;">
    ${logoHtml}
    <div style="min-width:0;">
      <div style="font-size:16px;font-weight:800;line-height:1.2;color:#fff;">${this.esc(school.name)}</div>
      ${contactParts.length ? `<div style="font-size:9px;color:#94a3b8;margin-top:3px;line-height:1.4;">${this.esc(contactParts.join('  ·  '))}</div>` : ''}
    </div>
  </div>
  <div style="text-align:right;flex:none;">
    <div style="font-size:14px;font-weight:800;color:#fff;line-height:1.25;">${this.esc(data.title.replace('Rapport — ', ''))}</div>
    <div style="font-size:9px;color:#94a3b8;margin-top:3px;">${today}</div>
  </div>
</div>

<!-- Accent bar + subtitle -->
<div style="height:3px;background:${c};"></div>
<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 20px;background:#f8fafc;border-bottom:1px solid #e2e8f0;">
  <div style="font-size:10px;color:#475569;font-weight:600;">${this.esc(data.subtitle)}</div>
  <div style="font-size:9px;color:#94a3b8;">${this.esc(data.paramsText)}</div>
</div>

${this.renderAnalysis(data.analysis ?? [], c)}

<!-- Table -->
<table style="margin-top:0;">
  <thead><tr>${ths}</tr></thead>
  <tbody>${tableRows}${emptyRow}</tbody>
</table>

<!-- Footer -->
<div style="margin-top:16px;padding:10px 20px;border-top:2px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;">
  <div style="font-size:9px;color:#475569;font-weight:700;">${data.totalLabel ? this.esc(data.totalLabel) : ''}</div>
  <div style="font-size:8px;color:#94a3b8;">${this.esc(school.name)} · ${today} · Document confidentiel</div>
</div>

</body></html>`;
  }

  private renderAnalysis(sections: AnalysisSection[], accentColor: string): string {
    if (!sections.length) return '';

    const sectionHtml = sections.map((section) => {
      const itemsHtml = section.items.map((item) => {
        const valColor = item.color ?? '#0f172a';
        const bg = item.highlight ? '#f8fafc' : '#fff';
        const border = item.highlight ? `2px solid ${valColor}` : '1px solid #e2e8f0';
        return `<div style="flex:1;min-width:120px;padding:10px 14px;background:${bg};border-left:${border};border-bottom:1px solid #e2e8f0;">
          <div style="font-size:8px;color:#64748b;text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:4px;">${this.esc(item.label)}</div>
          <div style="font-size:16px;font-weight:800;color:${valColor};line-height:1.2;">${this.esc(item.value)}</div>
        </div>`;
      }).join('');

      return `<div style="margin-bottom:0;">
        <div style="font-size:8px;font-weight:700;color:${accentColor};text-transform:uppercase;letter-spacing:.1em;padding:8px 20px 4px 20px;">${this.esc(section.title)}</div>
        <div style="display:flex;gap:0;padding:0 20px;">${itemsHtml}</div>
      </div>`;
    }).join('');

    return `<!-- Analyse / Bilan -->
<div style="padding:0 0 12px 0;border-bottom:1px solid #e2e8f0;margin-bottom:12px;">
  ${sectionHtml}
</div>`;
  }

  // ── Comparative HTML renderer ───────────────────────────────────────────

  private renderComparativeHtml(school: SchoolInfo, data: ComparativeReportData): string {
    const c = school.primaryColor;
    const today = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

    const logoHtml = school.logoUrl
      ? `<img src="${this.esc(school.logoUrl)}" alt="logo" style="width:50px;height:50px;object-fit:contain;flex:none;">`
      : `<div style="width:50px;height:50px;background:${c};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:18px;flex:none;border-radius:6px;">${this.esc(school.name.slice(0, 2).toUpperCase())}</div>`;

    const contactParts = [school.address, school.phone, school.email].filter(Boolean);

    // Evolution table
    const yearCols = data.years.map((y) => `<th style="background:#1e293b;color:#fff;padding:8px 12px;text-align:center;font-weight:700;font-size:10px;letter-spacing:.04em;">${this.esc(y)}</th>`).join('');

    const evoRows = data.evolutionRows.map((row, i) => {
      const bg = i % 2 === 0 ? '#fff' : '#f8fafc';
      const cells = data.years.map((y) => {
        const val = row.values.get(y) ?? '—';
        return `<td style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:#0f172a;border-bottom:1px solid #e2e8f0;">${this.esc(val)}</td>`;
      });

      // Delta column: last year vs first year
      let deltaCell = '';
      if (data.years.length >= 2) {
        const first = row.numValues.get(data.years[0]) ?? 0;
        const last = row.numValues.get(data.years[data.years.length - 1]) ?? 0;
        const evo = this.formatEvolution(last, first, row.higherIsBetter);
        deltaCell = `<td style="padding:8px 12px;text-align:center;font-size:11px;font-weight:800;color:${evo.color};border-bottom:1px solid #e2e8f0;">${this.esc(evo.text)}</td>`;
      }

      return `<tr style="background:${bg};">
        <td style="padding:8px 12px;font-size:10px;font-weight:600;color:#334155;border-bottom:1px solid #e2e8f0;">${this.esc(row.label)}</td>
        ${cells.join('')}
        ${deltaCell}
      </tr>`;
    }).join('');

    // Combined data table
    const dataThStyle = `background:#1e293b;color:#fff;padding:7px 8px;text-align:left;font-weight:600;font-size:7.5px;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;border-bottom:2px solid ${c};`;
    const dataThs = data.combinedHeaders.map((h) => `<th style="${dataThStyle}">${this.esc(h)}</th>`).join('');

    const dataRows = data.combinedRows.map((row, i) => {
      const bg = i % 2 === 0 ? '#fff' : '#f8fafc';
      const tds = row.map((cell, ci) => {
        const isYear = ci === 0;
        const style = isYear
          ? `padding:5px 8px;border-bottom:1px solid #e2e8f0;color:${c};font-size:8px;font-weight:700;vertical-align:top;`
          : `padding:5px 8px;border-bottom:1px solid #e2e8f0;color:#334155;font-size:8px;word-break:break-word;vertical-align:top;`;
        return `<td style="${style}">${this.esc(cell)}</td>`;
      }).join('');
      return `<tr style="background:${bg};">${tds}</tr>`;
    }).join('');

    const emptyRow = data.combinedRows.length === 0
      ? `<tr><td colspan="${data.combinedHeaders.length}" style="padding:30px;text-align:center;color:#94a3b8;font-size:11px;font-style:italic;">Aucune donnée disponible</td></tr>`
      : '';

    return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; background: #fff; color: #0f172a; }
  @page { size: A4 landscape; margin: 10mm 8mm 10mm 8mm; }
  table { border-collapse: collapse; width: 100%; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  td, th { overflow: hidden; text-overflow: ellipsis; }
</style>
</head><body>

<!-- Header band -->
<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;background:#1e293b;color:#fff;">
  <div style="display:flex;align-items:center;gap:14px;flex:1;min-width:0;">
    ${logoHtml}
    <div style="min-width:0;">
      <div style="font-size:16px;font-weight:800;line-height:1.2;color:#fff;">${this.esc(school.name)}</div>
      ${contactParts.length ? `<div style="font-size:9px;color:#94a3b8;margin-top:3px;line-height:1.4;">${this.esc(contactParts.join('  ·  '))}</div>` : ''}
    </div>
  </div>
  <div style="text-align:right;flex:none;">
    <div style="font-size:14px;font-weight:800;color:#fff;line-height:1.25;">${this.esc(data.title.replace('Rapport — ', ''))}</div>
    <div style="font-size:9px;color:#94a3b8;margin-top:3px;">${today}</div>
  </div>
</div>

<!-- Accent bar -->
<div style="height:3px;background:${c};"></div>

<!-- Comparative banner -->
<div style="padding:10px 20px;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;gap:10px;">
  <div style="font-size:8px;font-weight:700;color:${c};letter-spacing:.1em;text-transform:uppercase;">Analyse comparative</div>
  <div style="font-size:10px;color:#475569;font-weight:600;">${this.esc(data.years.join('  /  '))}</div>
</div>

<!-- Evolution table -->
<div style="padding:12px 20px;">
  <div style="font-size:8px;font-weight:700;color:${c};text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px;">Tableau d'évolution</div>
  <table>
    <thead>
      <tr>
        <th style="background:#1e293b;color:#fff;padding:8px 12px;text-align:left;font-weight:600;font-size:9px;letter-spacing:.06em;">Indicateur</th>
        ${yearCols}
        ${data.years.length >= 2 ? `<th style="background:#1e293b;color:#fff;padding:8px 12px;text-align:center;font-weight:700;font-size:9px;">Évolution</th>` : ''}
      </tr>
    </thead>
    <tbody>${evoRows}</tbody>
  </table>
</div>

<!-- Separator -->
<div style="border-top:2px solid #e2e8f0;margin:0 20px;"></div>

<!-- Combined data table -->
<div style="padding:12px 0 0 0;">
  <div style="font-size:8px;font-weight:700;color:${c};text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px;padding:0 20px;">Données détaillées</div>
  <table style="table-layout:fixed;">
    <thead><tr>${dataThs}</tr></thead>
    <tbody>${dataRows}${emptyRow}</tbody>
  </table>
</div>

<!-- Footer -->
<div style="margin-top:16px;padding:10px 20px;border-top:2px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;">
  <div style="font-size:9px;color:#475569;font-weight:700;">${data.totalLabel ? this.esc(data.totalLabel) : ''}</div>
  <div style="font-size:8px;color:#94a3b8;">${this.esc(school.name)} · ${today} · Document confidentiel</div>
</div>

</body></html>`;
  }

  // ── Puppeteer ────────────────────────────────────────────────────────────

  private async renderPdf(html: string): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1240, height: 877, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        format: 'A4',
        landscape: true,
        printBackground: true,
        preferCSSPageSize: false,
        margin: { top: '10mm', right: '8mm', bottom: '10mm', left: '8mm' },
      });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async getBrowser(): Promise<any> {
    if (!this.browserPromise) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const puppeteer = require('puppeteer');
      const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
      this.browserPromise = puppeteer.launch({
        headless: true,
        ...(executablePath ? { executablePath } : {}),
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      }).catch((error: unknown) => {
        this.browserPromise = null;
        throw error;
      });
    }
    return this.browserPromise;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private esc(value: string): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private formatDate(value: Date | string): string {
    const d = value instanceof Date ? value : new Date(value);
    return isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('fr-FR').format(d);
  }

  private formatDateTime(value: Date | string): string {
    const d = value instanceof Date ? value : new Date(value);
    return isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(d);
  }

  private formatFcfa(value: number | null | undefined): string {
    return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(Number(value ?? 0)))} FCFA`;
  }

  private periodLabel(value: string): string {
    const labels: Record<string, string> = {
      TRIMESTRE_1: '1er Trim.', TRIMESTRE_2: '2e Trim.', TRIMESTRE_3: '3e Trim.',
      SEMESTRE_1: 'Sem. 1', SEMESTRE_2: 'Sem. 2', SEMESTRE_3: 'Sem. 3',
    };
    return labels[value] ?? value.replace(/_/g, ' ');
  }

  private jourLabel(value: string): string {
    const labels: Record<string, string> = {
      LUNDI: 'Lundi', MARDI: 'Mardi', MERCREDI: 'Mercredi',
      JEUDI: 'Jeudi', VENDREDI: 'Vendredi', SAMEDI: 'Samedi', DIMANCHE: 'Dimanche',
    };
    return labels[value] ?? value;
  }

  private statutLabel(value: string): string {
    const labels: Record<string, string> = {
      BROUILLON: 'Brouillon', VALIDE: 'Validé', PUBLIE: 'Publié',
      ACTIF: 'Actif', INACTIF: 'Inactif', TRANSFERE: 'Transféré',
      EN_ATTENTE: 'En attente', ANNULE: 'Annulé',
    };
    return labels[value] ?? value.replace(/_/g, ' ');
  }

  private paymentTypeLabel(value: string): string {
    const labels: Record<string, string> = {
      SCOLARITE: 'Scolarité', INSCRIPTION: 'Inscription',
      CANTINE: 'Cantine', TRANSPORT: 'Transport', AUTRE: 'Autre',
    };
    return labels[value] ?? value.replace(/_/g, ' ');
  }

  private modeLabel(value: string): string {
    const labels: Record<string, string> = {
      ESPECES: 'Espèces', VIREMENT: 'Virement', CHEQUE: 'Chèque',
      MOBILE_MONEY: 'Mobile Money', CARTE: 'Carte',
    };
    return labels[value] ?? value.replace(/_/g, ' ');
  }

  private validColor(value?: string | null): string | null {
    const v = String(value ?? '').trim();
    if (!v) return null;
    return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v.toLowerCase() : null;
  }

  private storageKey(value: string | null | undefined): string | null {
    if (!value) return null;
    if (!value.startsWith('http')) return value;
    try {
      const url = new URL(value);
      const key = url.searchParams.get('key');
      if (key) return key;
      const segs = url.pathname.split('/').filter(Boolean);
      const bucket = segs.indexOf(process.env.S3_BUCKET ?? 'noura-school-files');
      return bucket >= 0 ? segs.slice(bucket + 1).join('/') || null : null;
    } catch {
      return null;
    }
  }

  private imageMimeType(buffer: Buffer): string {
    if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
    if (buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    if (buffer.subarray(0, 256).toString('utf8').trimStart().includes('<svg')) return 'image/svg+xml';
    return 'image/png';
  }
}
