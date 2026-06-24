import { Injectable, Logger, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { AsyncSemaphore } from '@/common/utils/async.util';
import { PrismaService } from '@/config/prisma.service';
import { StorageService } from '@/infrastructure/storage/storage.service';

interface BulletinSubjectRow {
  label: string;
  devoir1: string;
  devoir2: string;
  devoir3: string;
  composition: string;
  moyenne: number | null;
  coefficient: number;
  total: number | null;
  enseignant: string;
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
    rank: number | null;
    totalStudents: number | null;
    absences: number;
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
        classe: { select: { id: true, nom: true, anneeAcademiqueId: true } },
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

    const [student, config, tenant, notes, courses, assignments, director] = await Promise.all([
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
      this.prisma.matiereClasse.findMany({
        where: {
          tenantId,
          classeId: bulletin.classeId,
          ...(bulletin.classe.anneeAcademiqueId ? { anneeAcademiqueId: bulletin.classe.anneeAcademiqueId } : {}),
        },
        include: {
          matiere: { select: { id: true, libelle: true } },
          enseignant: { select: { firstName: true, lastName: true } },
        },
      }),
      directorPromise,
    ]);

    if (!student) throw new NotFoundException('Élève introuvable');

    const subjects = new Map<string, { label: string; coefficient: number; teacher: string }>();
    for (const course of courses) {
      subjects.set(course.matiereId, {
        label: course.matiere.libelle,
        coefficient: course.coefficient ?? 1,
        teacher: '—',
      });
    }
    for (const assignment of assignments) {
      const existing = subjects.get(assignment.matiereId);
      subjects.set(assignment.matiereId, {
        label: existing?.label ?? assignment.matiere.libelle,
        coefficient: existing?.coefficient ?? 1,
        teacher: `${assignment.enseignant.firstName} ${assignment.enseignant.lastName}`.trim() || '—',
      });
    }
    for (const note of notes) {
      if (!subjects.has(note.matiereId)) {
        subjects.set(note.matiereId, { label: note.matiere.libelle, coefficient: 1, teacher: '—' });
      }
    }

    const rows = [...subjects.entries()]
      .map(([matiereId, subject]) => this.toSubjectRow(subject, notes.filter((note) => note.matiereId === matiereId)))
      .sort((left, right) => left.label.localeCompare(right.label, 'fr'));
    const validRows = rows.filter((row) => row.moyenne !== null);
    const totalCoefficient = validRows.reduce((sum, row) => sum + row.coefficient, 0);
    const weightedTotal = validRows.reduce((sum, row) => sum + (row.total ?? 0), 0);
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
        classAverage: bulletin.moyenneClasse,
        rank: bulletin.rang,
        totalStudents: bulletin.totalEleves,
        absences: bulletin.nombreAbsences ?? 0,
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
    const devoirs = notes.filter((note) => note.typeEvaluation !== 'COMPOSITION');
    const compositions = notes.filter((note) => note.typeEvaluation === 'COMPOSITION');
    const average = (values: number[]) => values.length ? this.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
    const devoirAverage = average(devoirs.map(normalized));
    const compositionAverage = average(compositions.map(normalized));
    const moyenne = devoirAverage !== null && compositionAverage !== null
      ? this.round((devoirAverage + compositionAverage) / 2)
      : average(notes.map(normalized));
    const value = (note?: { note: number; noteSur: number }) => note ? `${this.formatNumber(normalized(note))}/20` : '—';

    return {
      label: subject.label,
      devoir1: value(devoirs[0]),
      devoir2: value(devoirs[1]),
      devoir3: value(devoirs[2]),
      composition: compositionAverage === null ? '—' : `${this.formatNumber(compositionAverage)}/20`,
      moyenne,
      coefficient: subject.coefficient,
      total: moyenne === null ? null : this.round(moyenne * subject.coefficient),
      enseignant: subject.teacher,
    };
  }

  private async renderPdf(html: string): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1754, height: 1240, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        format: 'A4',
        landscape: true,
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
    const rows = model.rows.length
      ? model.rows.map((row) => `<tr>
          <td class="subject">${this.escapeHtml(row.label)}</td><td>${row.devoir1}</td><td>${row.devoir2}</td><td>${row.devoir3}</td><td>${row.composition}</td>
          <td class="average">${row.moyenne === null ? '—' : `${this.formatNumber(row.moyenne)}/20`}</td><td>${this.formatNumber(row.coefficient)}</td>
          <td class="total">${row.total === null ? '—' : this.formatNumber(row.total)}</td><td class="teacher">${this.escapeHtml(row.enseignant)}</td>
        </tr>`).join('')
      : `<tr><td colspan="9" class="empty">Aucune note saisie pour cette période.</td></tr>`;
    const contact = [model.school.address, model.school.city, model.school.phone && `Tél. ${model.school.phone}`, model.school.email && `Email: ${model.school.email}`]
      .filter(Boolean).map((value) => this.escapeHtml(value)).join(' · ');

    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
      @page { size: A4 landscape; margin: 0; }
      * { box-sizing: border-box; } body { margin:0; color:#141b25; font-family: Arial, Helvetica, sans-serif; font-size:9px; background:#fff; }
      .page { --primary:${model.school.primaryColor}; width:297mm; min-height:210mm; padding:8mm 10mm 7mm; overflow:hidden; }
      .brand { display:flex; justify-content:space-between; gap:8mm; min-height:25mm; align-items:flex-start; }
      .brand-left { display:flex; gap:4mm; } .school-logo { width:20mm; height:20mm; display:flex; align-items:center; justify-content:center; overflow:hidden; font-size:16px; font-weight:800; color:var(--primary); }
      .school-logo img { width:100%; height:100%; object-fit:contain; } h1 { margin:0; font-size:18px; line-height:1.1; } .slogan { margin:1.5mm 0 1mm; font-size:10px; color:var(--primary); font-weight:700; }
      .contact { margin:0; color:#4b5563; line-height:1.35; max-width:155mm; } .republic { text-align:right; min-width:52mm; } .republic strong { display:block; font-size:15px; } .republic span { display:block; margin-top:2.5mm; font-size:10px; font-weight:700; } .republic small { display:block; margin-top:1mm; color:#667085; }
      .rule { height:1px; margin:4mm 0; background:var(--primary); }
      .overview { display:grid; grid-template-columns:1fr 1fr; gap:5mm; margin-bottom:4mm; } .card { min-height:35mm; padding:4mm 5mm; border-radius:2mm; background:#f8f9fb; } .card.results { background:color-mix(in srgb, var(--primary) 9%, white); } h2 { margin:0 0 3mm; font-size:11px; } .card p { margin:0 0 1.6mm; } .card strong { font-weight:700; } .green { color:var(--primary); font-weight:800; }
      .notes-title { font-size:11px; margin:0 0 2mm; } table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:8.2px; } th,td { border:1px solid #9aa2ac; padding:2.1mm 1.3mm; text-align:center; vertical-align:middle; word-wrap:break-word; } th { background:#f0f2f5; font-weight:700; } td.subject, td.teacher { text-align:left; } td.subject { font-weight:700; } td.average { color:var(--primary); font-weight:800; } td.total { font-weight:800; } .empty { padding:6mm; color:#667085; }
      tfoot td { background:color-mix(in srgb, var(--primary) 8%, #e7e9ed); font-weight:800; } .after-table { display:grid; grid-template-columns:1fr 1fr; gap:7mm; margin-top:4mm; } .appreciation { min-height:24mm; padding:4mm 5mm; background:color-mix(in srgb, var(--primary) 7%, white); border-radius:2mm; } .appreciation h2 { margin-bottom:2mm; } .appreciation p { margin:0; font-style:italic; color:#475467; } .signatures { padding:1mm 0; } .signature { min-height:11mm; text-align:center; padding-top:1mm; border-bottom:1px solid #c9ced5; } .signature + .signature { margin-top:3mm; } .signature strong { display:block; margin-bottom:4mm; } .director-stamp { display:block; width:30mm; max-height:18mm; margin:0 auto 3mm; object-fit:contain; }
      .footer { margin-top:4mm; padding-top:3mm; border-top:1px solid #d7dbe0; text-align:center; color:#5b6573; font-size:7.8px; line-height:1.35; } .footer small { display:block; }
    </style></head><body><main class="page">
      <header class="brand"><div class="brand-left"><div class="school-logo">${logo}</div><div><h1>${this.escapeHtml(model.school.name)}</h1>${model.school.slogan ? `<p class="slogan">${this.escapeHtml(model.school.slogan)}</p>` : ''}<p class="contact">${contact}</p></div></div>
      ${isMauritania ? `<div class="republic"><strong lang="ar">شرف إخاء عدل</strong><span>Honneur, Fraternité, Justice</span><small>République Islamique de Mauritanie</small></div>` : `<div class="republic"><strong>Bulletin scolaire</strong><span>${this.escapeHtml(model.bulletin.period)}</span><small>${this.escapeHtml(model.bulletin.year)}</small></div>`}</header>
      <div class="rule"></div><section class="overview"><div class="card"><h2>Informations de l'élève</h2><p><strong>Nom complet:</strong> ${this.escapeHtml(model.student.name)}</p>${model.student.matricule ? `<p><strong>Matricule:</strong> ${this.escapeHtml(model.student.matricule)}</p>` : ''}<p><strong>Classe:</strong> ${this.escapeHtml(model.student.classe)}</p><p><strong>Année scolaire:</strong> ${this.escapeHtml(model.bulletin.year)}</p><p><strong>Trimestre:</strong> ${this.escapeHtml(model.bulletin.period)}</p>${model.student.birthDate ? `<p><strong>Date de naissance:</strong> ${this.escapeHtml(model.student.birthDate)}</p>` : ''}${model.student.birthPlace ? `<p><strong>Lieu de naissance:</strong> ${this.escapeHtml(model.student.birthPlace)}</p>` : ''}</div>
      <div class="card results"><h2>Résultats généraux</h2><p><strong>Moyenne générale:</strong> <span class="green">${model.bulletin.average === null ? '—' : `${this.formatNumber(model.bulletin.average)}/20`}</span></p>${model.bulletin.classAverage !== null ? `<p><strong>Moyenne de la classe:</strong> ${this.formatNumber(model.bulletin.classAverage)}/20</p>` : ''}${model.bulletin.rank !== null ? `<p><strong>Rang:</strong> ${model.bulletin.rank}${model.bulletin.totalStudents ? ` sur ${model.bulletin.totalStudents} élèves` : ''}</p>` : ''}<p><strong>Date d'émission:</strong> ${model.bulletin.issueDate}</p><p><strong>École:</strong> ${this.escapeHtml(model.school.name)}${model.school.city ? ` - ${this.escapeHtml(model.school.city)}` : ''}</p></div></section>
      <section><h2 class="notes-title">Détail des notes par matière</h2><table><colgroup><col style="width:15%"><col style="width:8.5%"><col style="width:8.5%"><col style="width:8.5%"><col style="width:11%"><col style="width:10%"><col style="width:9%"><col style="width:8%"><col style="width:21.5%"></colgroup><thead><tr><th>Matière</th><th>Devoir 1</th><th>Devoir 2</th><th>Devoir 3</th><th>Composition</th><th>Moyenne</th><th>Coefficient</th><th>Total</th><th>Enseignant</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td class="subject">TOTAL GÉNÉRAL</td><td>—</td><td>—</td><td>—</td><td>—</td><td class="average">${model.bulletin.average === null ? '—' : `${this.formatNumber(model.bulletin.average)}/20`}</td><td>${this.formatNumber(model.totalCoefficient)}</td><td class="total">${this.formatNumber(model.weightedTotal)}</td><td>—</td></tr></tfoot></table></section>
      <section class="after-table"><div class="appreciation"><h2>Appréciation générale</h2><p>"${this.escapeHtml(model.bulletin.appreciation)}"</p></div><div class="signatures"><div class="signature"><strong>Le Directeur</strong>${stamp}<span>${this.escapeHtml(model.bulletin.director)}</span></div><div class="signature"><strong>Signature des parents</strong></div></div></section>
      <footer class="footer"><div>${this.escapeHtml(model.school.name)}${contact ? ` - ${contact}` : ''}</div><small>Bulletin édité le ${model.bulletin.issueDate} · Référence ${model.bulletin.reference}</small></footer>
    </main></body></html>`;
  }

  private periodLabel(value: string): string {
    const labels: Record<string, string> = {
      TRIMESTRE_1: '1er Trimestre', TRIMESTRE_2: '2e Trimestre', TRIMESTRE_3: '3e Trimestre',
      SEMESTRE_1: 'Semestre 1', SEMESTRE_2: 'Semestre 2', SEMESTRE_3: 'Semestre 3',
    };
    return labels[value] ?? value.replace(/_/g, ' ');
  }

  private appreciation(value: number | null): string {
    if (value === null) return 'Résultats en attente de saisie.';
    if (value >= 16) return 'Excellent travail, continuez ainsi.';
    if (value >= 14) return 'Très bon travail, continuez vos efforts.';
    if (value >= 10) return 'Résultats satisfaisants, poursuivez vos efforts.';
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
