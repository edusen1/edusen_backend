import { Injectable, Logger, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { AsyncSemaphore } from '@/common/utils/async.util';
import { PrismaService } from '@/config/prisma.service';
import { StorageService } from '@/infrastructure/storage/storage.service';

interface BulletinSubjectRow {
  label: string;
  moyDevoirs: string;
  composition: string;
  moyenne: number;
  coefficient: number;
  total: number;
  appreciation: string;
}

interface BulletinDocumentModel {
  school: {
    name: string;
    slogan: string;
    address: string;
    city: string;
    country: string;
    phone: string;
    email: string;
    logoUrl: string | null;
    primaryColor: string;
    cachetUrl: string | null;
  };
  student: {
    name: string;
    matricule: string;
    birthDate: string;
    birthPlace: string;
    classe: string;
  };
  bulletin: {
    period: string;
    year: string;
    average: number | null;
    classAverage: number | null;
    classAverageMin: number | null;
    classAverageMax: number | null;
    rank: number | null;
    totalStudents: number | null;
    absences: number;
    tardies: number;
    appreciation: string;
    issueDate: string;
    director: string;
    reference: string;
  };
  rows: BulletinSubjectRow[];
  totalCoefficient: number;
  weightedTotal: number;
}

const pdfRenderSemaphore = new AsyncSemaphore(Math.max(1, Number(process.env.BULLETIN_PDF_CONCURRENCY ?? 1)));

@Injectable()
export class BulletinDocumentService implements OnModuleDestroy {
  private readonly logger = new Logger(BulletinDocumentService.name);
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
      // The process is stopping; Chromium can already be gone.
    } finally {
      this.browserPromise = null;
    }
  }

  async generate(tenantId: string, bulletinId: string): Promise<{ buffer: Buffer; filename: string }> {
    const model = await this.buildModel(tenantId, bulletinId);
    const html = this.renderHtml(model);
    const buffer = await pdfRenderSemaphore.run(() => this.renderPdf(html));
    return {
      buffer,
      filename: `bulletin-${this.slug(model.student.name)}-${this.slug(model.bulletin.period)}.pdf`,
    };
  }

  private async buildModel(tenantId: string, bulletinId: string): Promise<BulletinDocumentModel> {
    const bulletin = await this.prisma.bulletin.findFirst({
      where: { id: bulletinId, tenantId },
      include: {
        classe: { select: { id: true, nom: true, anneeAcademiqueId: true, niveauId: true } },
      },
    });
    if (!bulletin) throw new NotFoundException('Bulletin introuvable');

    const directorPromise = bulletin.validePar
      ? this.prisma.user.findUnique({
        where: { id: bulletin.validePar },
        select: { firstName: true, lastName: true },
      })
      : this.prisma.user.findFirst({
        where: { tenantId, role: 'ADMIN', actif: true },
        select: { firstName: true, lastName: true },
        orderBy: { createdAt: 'asc' },
      });

    const [student, config, tenant, notes, courses, matiereNiveaux, director] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: bulletin.eleveId, tenantId },
        select: { firstName: true, lastName: true, matricule: true, dateNaissance: true, lieuNaissance: true },
      }),
      this.prisma.ecoleConfig.findUnique({ where: { tenantId } }),
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { nom: true, adresse: true, telephone: true, emailContact: true, logoUrl: true } }),
      this.prisma.note.findMany({
        where: {
          tenantId,
          eleveId: bulletin.eleveId,
          trimestre: bulletin.trimestre,
          anneeScolaire: bulletin.anneeScolaire,
        },
        include: { matiere: { select: { id: true, libelle: true } } },
        orderBy: [{ matiere: { libelle: 'asc' } }, { dateEvaluation: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.cours.findMany({
        where: {
          tenantId,
          classeId: bulletin.classeId,
          OR: [
            ...(bulletin.classe.anneeAcademiqueId ? [{ anneeAcademiqueId: bulletin.classe.anneeAcademiqueId }] : []),
            { anneeAcademiqueId: null },
          ],
        },
        include: {
          matiere: { select: { id: true, libelle: true } },
        },
      }),
      // MatiereNiveau = source de vérité pour les coefficients
      bulletin.classe.niveauId
        ? this.prisma.matiereNiveau.findMany({
            where: { tenantId, niveauId: bulletin.classe.niveauId },
            select: { matiereId: true, coefficient: true, noteMaximum: true },
          })
        : Promise.resolve([]),
      directorPromise,
    ]);

    if (!student) throw new NotFoundException('Élève introuvable');

    // Coefficients depuis MatiereNiveau (config admin)
    const coefMap = new Map<string, number>();
    for (const mn of (matiereNiveaux as Array<{ matiereId: string; coefficient: number }>)) {
      coefMap.set(mn.matiereId, mn.coefficient ?? 1);
    }

    const subjects = new Map<string, { label: string; coefficient: number; teacher: string }>();
    for (const course of courses) {
      subjects.set(course.matiereId, {
        label: course.matiere.libelle,
        coefficient: coefMap.get(course.matiereId) ?? course.coefficient ?? 1,
        teacher: '—',
      });
    }
    // Matières depuis MatiereNiveau qui ne sont pas dans Cours
    for (const mn of (matiereNiveaux as Array<{ matiereId: string; coefficient: number }>)) {
      if (!subjects.has(mn.matiereId)) {
        const note = notes.find((n) => n.matiereId === mn.matiereId);
        if (note) {
          subjects.set(mn.matiereId, { label: note.matiere.libelle, coefficient: mn.coefficient ?? 1, teacher: '—' });
        }
      }
    }
    for (const note of notes) {
      if (!subjects.has(note.matiereId)) {
        subjects.set(note.matiereId, { label: note.matiere.libelle, coefficient: coefMap.get(note.matiereId) ?? 1, teacher: '—' });
      }
    }

    const rows = [...subjects.entries()]
      .map(([matiereId, subject]) => this.toSubjectRow(subject, notes.filter((note) => note.matiereId === matiereId)))
      .sort((left, right) => left.label.localeCompare(right.label, 'fr'));
    // TOUTES les matières comptent — note nulle = 0
    const totalCoefficient = rows.reduce((sum, row) => sum + row.coefficient, 0);
    const weightedTotal = rows.reduce((sum, row) => sum + row.total, 0);
    const computedAverage = totalCoefficient > 0 ? this.round(weightedTotal / totalCoefficient) : null;

    const storedLogo = config?.logoUrl ?? tenant?.logoUrl;
    const schoolName = config?.nom ?? tenant?.nom ?? 'Noura School';
    const country = config?.pays ?? 'MR';
    const address = config?.adresse ?? tenant?.adresse ?? '';
    return {
      school: {
        name: schoolName,
        slogan: config?.slogan ?? '',
        address,
        city: config?.ville ?? '',
        country,
        phone: config?.telephone ?? tenant?.telephone ?? '',
        email: config?.email ?? tenant?.emailContact ?? '',
        logoUrl: (await this.embedSchoolLogo(storedLogo)) ?? this.storage.resolveUrl(storedLogo) ?? null,
        primaryColor: this.bulletinPrimaryColor(config?.primaryColor),
        cachetUrl: this.storage.resolveUrl(config?.cachetUrl) ?? null,
      },
      student: {
        name: `${student.firstName} ${student.lastName}`.trim(),
        matricule: student.matricule ?? '',
        birthDate: student.dateNaissance ? this.formatDate(student.dateNaissance) : '',
        birthPlace: student.lieuNaissance ?? '',
        classe: bulletin.classe.nom,
      },
      bulletin: {
        period: this.periodLabel(bulletin.trimestre),
        year: bulletin.anneeScolaire,
        average: bulletin.moyenne ?? computedAverage,
        classAverage: bulletin.moyenneClasse ?? null,
        classAverageMin: null,
        classAverageMax: null,
        rank: bulletin.rang,
        totalStudents: bulletin.totalEleves,
        absences: bulletin.nombreAbsences ?? 0,
        tardies: bulletin.nombreRetards ?? 0,
        appreciation: bulletin.appreciation ?? this.appreciation(bulletin.moyenne ?? computedAverage),
        issueDate: this.formatDate(new Date()),
        director: director ? `${director.firstName} ${director.lastName}`.trim() : 'La Direction',
        reference: bulletin.id.slice(0, 8).toUpperCase(),
      },
      rows,
      totalCoefficient,
      weightedTotal: this.round(weightedTotal),
    };
  }

  private toSubjectRow(
    subject: { label: string; coefficient: number; teacher: string },
    notes: Array<{ typeEvaluation: string; note: number; noteSur: number; commentaire: string | null }>,
  ): BulletinSubjectRow {
    const normalized = (note: { note: number; noteSur: number }) => (note.note / (note.noteSur || 20)) * 20;
    const devoirs = notes.filter((note) => !['COMPOSITION', 'EXAMEN', 'BONUS'].includes(note.typeEvaluation));
    const compositions = notes.filter((note) => note.typeEvaluation === 'COMPOSITION' || note.typeEvaluation === 'EXAMEN');
    const avg = (values: number[]) => values.length ? this.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
    const devoirAverage = avg(devoirs.map(normalized));
    const compositionAverage = avg(compositions.map(normalized));
    // Moyenne = (devoirs + composition) / 2 — note nulle = 0, toutes matières comptent
    const da = devoirAverage ?? 0;
    const ca = compositionAverage ?? 0;
    const moyenne = this.round((da + ca) / 2);

    /**
     * Seuils alignés sur ceux de l'écran (`admin/bulletins`, `getMention`).
     * Ils divergeaient : le PDF décalait toute l'échelle d'un cran et ajoutait
     * « EXCELLENT ». Une moyenne de 14,5 était affichée « B » à l'écran et
     * imprimée « TRÈS BIEN » sur le bulletin remis à la famille.
     *
     * Barème retenu : celui en usage au Sénégal — 16 très bien, 14 bien,
     * 12 assez bien, 10 passable.
     *
     * `moyenne` est déjà ramenée sur 20 par `normalized()`, la comparaison vaut
     * donc aussi pour les cycles notés sur 10.
     */
    const mentionForNote = (v: number | null) => {
      if (v === null) return '';
      if (v >= 16) return 'TRÈS BIEN';
      if (v >= 14) return 'BIEN';
      if (v >= 12) return 'ASSEZ BIEN';
      if (v >= 10) return 'PASSABLE';
      return 'INSUFFISANT';
    };

    return {
      label: subject.label,
      moyDevoirs: devoirAverage === null ? '—' : this.formatNumber(devoirAverage),
      composition: compositionAverage === null ? '—' : this.formatNumber(compositionAverage),
      moyenne,
      coefficient: subject.coefficient,
      total: this.round(moyenne * subject.coefficient),
      appreciation: mentionForNote(moyenne),
    };
  }

  private async renderPdf(html: string): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        format: 'A4',
        landscape: false,
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async getBrowser(): Promise<any> {
    if (!this.browserPromise) {
      // Puppeteer is already installed for whatsapp-web.js and Chromium is in the Docker image.
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

  private renderHtml(model: BulletinDocumentModel): string {
    const isMauritania = ['MR', 'MAURITANIE'].includes(model.school.country.toUpperCase());
    const logo = model.school.logoUrl
      ? `<img src="${this.escapeAttribute(model.school.logoUrl)}" alt="Logo ${this.escapeHtml(model.school.name)}">`
      : `<span>${this.escapeHtml(model.school.name.slice(0, 1).toUpperCase() || 'N')}</span>`;
    const stamp = model.school.cachetUrl
      ? `<img class="director-stamp" src="${this.escapeAttribute(model.school.cachetUrl)}" alt="Cachet du directeur">`
      : '';
    const periodLabel = model.bulletin.period.includes('Semestre') ? 'Semestrielle' : 'Trimestrielle';
    const rows = model.rows.length
      ? model.rows.map((row) => `<tr>
          <td class="subject">${this.escapeHtml(row.label)}</td>
          <td>${row.moyDevoirs}</td>
          <td>${row.composition}</td>
          <td class="average">${this.formatNumber(row.moyenne)}</td>
          <td>${this.formatNumber(row.coefficient)}</td>
          <td class="total">${this.formatNumber(row.total)}</td>
          <td class="teacher">${row.appreciation}</td>
        </tr>`).join('')
      : `<tr><td colspan="7" class="empty">Aucune note saisie pour cette période.</td></tr>`;
    const contact = [model.school.address, model.school.city, model.school.phone && `Tél. ${model.school.phone}`, model.school.email && `Email: ${model.school.email}`]
      .filter(Boolean).map((value) => this.escapeHtml(value)).join(' · ');

    const rankLabel = model.bulletin.rank === 1 ? '1er' : model.bulletin.rank !== null ? `${model.bulletin.rank}ème` : '—';
    const totalSur = this.formatNumber(model.totalCoefficient * 20);

    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
      @page { size: A4 portrait; margin: 0; }
      * { box-sizing: border-box; } body { margin:0; color:#141b25; font-family: Arial, Helvetica, sans-serif; font-size:11px; background:#fff; }
      .page { --primary:${model.school.primaryColor}; width:210mm; min-height:297mm; padding:10mm 12mm 8mm; overflow:hidden; }
      .brand { display:flex; justify-content:space-between; gap:6mm; min-height:22mm; align-items:flex-start; }
      .brand-left { display:flex; gap:4mm; } .school-logo { width:18mm; height:18mm; display:flex; align-items:center; justify-content:center; overflow:hidden; font-size:14px; font-weight:800; color:var(--primary); }
      .school-logo img { width:100%; height:100%; object-fit:contain; } h1 { margin:0; font-size:16px; line-height:1.2; } .slogan { margin:1.5mm 0 1mm; font-size:10px; color:var(--primary); font-weight:700; }
      .contact { margin:0; color:#4b5563; font-size:9px; line-height:1.35; max-width:120mm; } .republic { text-align:right; min-width:45mm; } .republic strong { display:block; font-size:14px; } .republic span { display:block; margin-top:2mm; font-size:10px; font-weight:700; } .republic small { display:block; margin-top:1mm; color:#667085; font-size:9px; }
      .rule { height:1px; margin:3mm 0; background:var(--primary); }
      .overview { display:grid; grid-template-columns:1fr 1fr; gap:4mm; margin-bottom:4mm; } .card { padding:4mm 5mm; border-radius:2mm; background:#f8f9fb; } .card.results { background:color-mix(in srgb, var(--primary) 9%, white); } h2 { margin:0 0 2.5mm; font-size:12px; } .card p { margin:0 0 1.8mm; font-size:10px; } .card strong { font-weight:700; } .green { color:var(--primary); font-weight:800; }
      .notes-title { font-size:12px; margin:0 0 2mm; } table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:10px; } th,td { border:1px solid #9aa2ac; padding:2.5mm 1.5mm; text-align:center; vertical-align:middle; word-wrap:break-word; } th { background:#f0f2f5; font-weight:700; font-size:9px; } td.subject, td.teacher { text-align:left; } td.subject { font-weight:700; } td.average { color:var(--primary); font-weight:800; } td.total { font-weight:800; } .empty { padding:6mm; color:#667085; }
      tfoot td { background:color-mix(in srgb, var(--primary) 8%, #e7e9ed); font-weight:800; }
      .summary { display:grid; grid-template-columns:1fr 1fr 1fr 1fr; border:1px solid #9aa2ac; margin-top:0; }
      .summary-cell { padding:3mm 4mm; border-right:1px solid #ccc; } .summary-cell:last-child { border-right:none; }
      .summary-label { font-size:9px; color:#667085; margin-bottom:1mm; } .summary-value { font-size:14px; font-weight:800; color:#141b25; } .summary-sub { font-size:9px; color:#667085; font-weight:400; }
      .after-table { display:grid; grid-template-columns:1fr 1fr; gap:6mm; margin-top:5mm; } .appreciation { min-height:22mm; padding:4mm 5mm; background:color-mix(in srgb, var(--primary) 7%, white); border-radius:2mm; } .appreciation h2 { margin-bottom:2mm; font-size:12px; } .appreciation p { margin:0; font-style:italic; color:#475467; font-size:10px; }
      .decision-box { padding:4mm 5mm; } .decision-box h2 { margin-bottom:2mm; font-size:11px; } .decision-list { font-size:9.5px; line-height:1.7; } .decision-list .check { display:inline-block; width:10px; height:10px; border:1px solid #999; margin-right:2mm; vertical-align:middle; }
      .signatures { padding:1mm 0; } .signature { min-height:14mm; text-align:center; padding-top:2mm; } .signature strong { display:block; margin-bottom:5mm; font-size:11px; } .director-stamp { display:block; width:28mm; max-height:18mm; margin:0 auto 3mm; object-fit:contain; }
      .footer { margin-top:4mm; padding-top:3mm; border-top:1px solid #d7dbe0; text-align:center; color:#5b6573; font-size:9px; line-height:1.35; } .footer small { display:block; }
    </style></head><body><main class="page">
      <header class="brand"><div class="brand-left"><div class="school-logo">${logo}</div><div><h1>${this.escapeHtml(model.school.name)}</h1>${model.school.slogan ? `<p class="slogan">${this.escapeHtml(model.school.slogan)}</p>` : ''}<p class="contact">${contact}</p></div></div>
      ${isMauritania ? `<div class="republic"><strong lang="ar">شرف إخاء عدل</strong><span>Honneur, Fraternité, Justice</span><small>République Islamique de Mauritanie</small></div>` : `<div class="republic"><strong>Bulletin de Composition</strong><span>${this.escapeHtml(model.bulletin.period)}</span><small>${this.escapeHtml(model.bulletin.year)}</small></div>`}</header>
      <div class="rule"></div>
      <section class="overview">
        <div class="card"><h2>Informations de l'élève</h2><p><strong>Nom complet:</strong> ${this.escapeHtml(model.student.name)}</p>${model.student.matricule ? `<p><strong>Matricule:</strong> ${this.escapeHtml(model.student.matricule)}</p>` : ''}<p><strong>Classe:</strong> ${this.escapeHtml(model.student.classe)}</p>${model.student.birthDate ? `<p><strong>Né(e) le:</strong> ${this.escapeHtml(model.student.birthDate)}${model.student.birthPlace ? ` à ${this.escapeHtml(model.student.birthPlace)}` : ''}</p>` : ''}<p><strong>Effectif:</strong> ${model.bulletin.totalStudents ?? '—'}</p></div>
        <div class="card results"><h2>Résultats</h2><p><strong>Moyenne ${periodLabel.toLowerCase()}:</strong> <span class="green">${model.bulletin.average === null ? '—' : `${this.formatNumber(model.bulletin.average)}/20`}</span></p>${model.bulletin.rank !== null ? `<p><strong>Rang:</strong> ${rankLabel}${model.bulletin.totalStudents ? ` sur ${model.bulletin.totalStudents}` : ''}</p>` : ''}${model.bulletin.classAverage !== null ? `<p><strong>Moyenne classe:</strong> ${this.formatNumber(model.bulletin.classAverage)}/20</p>` : ''}<p><strong>Absences:</strong> ${model.bulletin.absences ?? 0} &nbsp; <strong>Retards:</strong> ${model.bulletin.tardies ?? 0}</p><p><strong>Année:</strong> ${this.escapeHtml(model.bulletin.year)}</p></div>
      </section>
      <section><h2 class="notes-title">Détail des notes</h2><table><colgroup><col style="width:22%"><col style="width:12%"><col style="width:12%"><col style="width:12%"><col style="width:7%"><col style="width:12%"><col style="width:23%"></colgroup><thead><tr><th>Disciplines</th><th>Devoirs<br><small>sur 20</small></th><th>Composition<br><small>sur 20</small></th><th>${periodLabel}<br><small>sur 20</small></th><th>Coef.</th><th>${periodLabel}<br><small>× Coef</small></th><th>Appréciations</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td class="subject">TOTAL</td><td></td><td></td><td class="average">${model.bulletin.average === null ? '—' : `${this.formatNumber(model.bulletin.average)}/20`}</td><td>${this.formatNumber(model.totalCoefficient)}</td><td class="total">${this.formatNumber(model.weightedTotal)}</td><td></td></tr></tfoot></table></section>
      <!-- Résumé bas -->
      <div class="summary">
        <div class="summary-cell"><div class="summary-label">Moyenne ${periodLabel.toLowerCase()}</div><div class="summary-value">${model.bulletin.average !== null ? this.formatNumber(model.bulletin.average) : '—'} <span class="summary-sub">sur 20</span></div><div style="margin-top:1mm;font-size:10px">Rang: <strong>${rankLabel}</strong></div></div>
        <div class="summary-cell"><div class="summary-label">Moyenne classe</div><div class="summary-value">${model.bulletin.classAverage !== null ? this.formatNumber(model.bulletin.classAverage) : '—'} <span class="summary-sub">sur 20</span></div></div>
        <div class="summary-cell"><div class="summary-label">Absences</div><div class="summary-value">${model.bulletin.absences ?? 0}</div></div>
        <div class="summary-cell"><div class="summary-label">Retards</div><div class="summary-value">${model.bulletin.tardies ?? 0}</div></div>
      </div>
      <section class="after-table">
        <div>
          <div class="appreciation"><h2>Appréciation générale</h2><p>"${this.escapeHtml(model.bulletin.appreciation)}"</p></div>
          <div class="decision-box"><h2>Décision du conseil</h2><div class="decision-list"><div><span class="check"></span> Excellent</div><div><span class="check"></span> Tableau d'honneur</div><div><span class="check"></span> Assez bon travail</div><div><span class="check"></span> Travail passable</div><div><span class="check"></span> Travail insuffisant</div><div><span class="check"></span> Doit doubler d'efforts</div></div></div>
        </div>
        <div class="signatures"><div class="signature"><strong>Le Directeur</strong>${stamp}<span>${this.escapeHtml(model.bulletin.director)}</span></div></div>
      </section>
      <footer class="footer"><div>${this.escapeHtml(model.school.name)}${contact ? ` - ${contact}` : ''}</div><small>Bulletin édité le ${model.bulletin.issueDate} · Réf. ${model.bulletin.reference}</small></footer>
    </main></body></html>`;
  }

  private periodLabel(value: string): string {
    const labels: Record<string, string> = {
      TRIMESTRE_1: '1er Trimestre', TRIMESTRE_2: '2e Trimestre', TRIMESTRE_3: '3e Trimestre',
      SEMESTRE_1: 'Semestre 1', SEMESTRE_2: 'Semestre 2', SEMESTRE_3: 'Semestre 3',
    };
    return labels[value] ?? value.replace(/_/g, ' ');
  }

  /**
   * Phrase d'appréciation générale. Ses paliers suivent les mêmes seuils que les
   * mentions par matière (16 / 14 / 12 / 10) : ils sautaient auparavant le palier
   * 12, si bien qu'un élève à 12,5 — « assez bien » par matière — recevait la
   * même phrase qu'un élève à 10.
   */
  private appreciation(value: number | null): string {
    if (value === null) return 'Résultats en attente de saisie.';
    if (value >= 16) return 'Très bon travail, continuez ainsi.';
    if (value >= 14) return 'Bon travail, continuez vos efforts.';
    if (value >= 12) return 'Résultats assez satisfaisants, poursuivez vos efforts.';
    if (value >= 10) return 'Résultats passables, des progrès restent possibles.';
    return 'Des efforts supplémentaires sont attendus pour progresser.';
  }

  private formatDate(date: Date): string { return new Intl.DateTimeFormat('fr-FR').format(date); }
  private formatNumber(value: number): string { return Number(value.toFixed(2)).toFixed(2).replace('.', ','); }
  private round(value: number): number { return Math.round(value * 100) / 100; }
  private slug(value: string): string { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '').toLowerCase() || 'document'; }
  private escapeHtml(value: string): string { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }
  private escapeAttribute(value: string): string { return this.escapeHtml(value); }

  private bulletinPrimaryColor(value?: string | null): string {
    const normalized = String(value ?? '').trim();
    if (!normalized) return '#148343';
    const match = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!match) return '#148343';
    if (match[1].length === 3) {
      const [r, g, b] = match[1].split('').map((char) => char + char).join('');
      return `#${r}${g}${b}`;
    }
    return normalized.toLowerCase();
  }

  private async embedSchoolLogo(storedLogo: string | null | undefined): Promise<string | null> {
    if (!storedLogo) return null;
    // Already a data URL (base64 inline) — use directly
    if (storedLogo.startsWith('data:')) return storedLogo;

    const key = this.storageKey(storedLogo);
    if (!key) return null;

    try {
      const buffer = await this.storage.getPrivateBuffer(key);
      if (!buffer?.length) return null;
      return `data:${this.imageMimeType(buffer)};base64,${buffer.toString('base64')}`;
    } catch (error) {
      this.logger.warn(`Impossible d'intégrer le logo au PDF: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private storageKey(value: string | null | undefined): string | null {
    if (!value) return null;
    if (!value.startsWith('http')) return value;
    try {
      const url = new URL(value);
      const storageKey = url.searchParams.get('key');
      if (storageKey) return storageKey;
      const segments = url.pathname.split('/').filter(Boolean);
      const bucketIndex = segments.indexOf(process.env.S3_BUCKET ?? 'noura-school-files');
      return bucketIndex >= 0 ? segments.slice(bucketIndex + 1).join('/') || null : null;
    } catch {
      return null;
    }
  }

  private imageMimeType(buffer: Buffer): string {
    if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
    if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
    if (buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    if (buffer.subarray(0, 256).toString('utf8').trimStart().includes('<svg')) return 'image/svg+xml';
    return 'image/png';
  }
}
