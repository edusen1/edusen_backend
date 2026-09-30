import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { StorageService } from '@/infrastructure/storage/storage.service';
import { AsyncSemaphore } from '@/common/utils/async.util';

export interface FournitureDocItem {
  nom: string;
  quantite: number;
  obligatoire: boolean;
  description?: string | null;
}

interface InscriptionSource {
  numeroInscription: string;
  anneeLibelle: string;
  dateInscription: Date | string;
  eleve: { firstName: string; lastName: string; matricule?: string | null };
  classe: { nom: string };
  school: { name: string; initials: string; address: string; phone: string; email: string; logoUrl: string | null };
}

const pdfSemaphore = new AsyncSemaphore(Math.max(1, Number(process.env.INSCRIPTION_PDF_CONCURRENCY ?? 1)));

@Injectable()
export class InscriptionDocumentService implements OnModuleDestroy {
  private readonly logger = new Logger(InscriptionDocumentService.name);
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
      // nothing
    } finally {
      this.browserPromise = null;
    }
  }

  async generate(
    tenantId: string,
    eleveId: string,
    classeId: string,
    fournitures: FournitureDocItem[],
  ): Promise<{ buffer: Buffer; filename: string; s3Key: string } | null> {
    try {
      const source = await this.buildSource(tenantId, eleveId, classeId);
      if (!source) return null;
      const html = this.renderHtml(source, fournitures);
      const buffer = await pdfSemaphore.run(() => this.renderPdf(html));
      const slug = source.numeroInscription.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
      const filename = `fiche-inscription-${slug}.pdf`;
      const s3Key = `${tenantId}/inscriptions/${slug}.pdf`;
      await this.storage.upload(s3Key, buffer, 'application/pdf');
      this.logger.log(`[InscriptionDoc] PDF généré et stocké: ${s3Key}`);
      return { buffer, filename, s3Key };
    } catch (err: unknown) {
      this.logger.warn(`[InscriptionDoc] Erreur génération: ${(err as Error).message}`);
      return null;
    }
  }

  private async buildSource(tenantId: string, eleveId: string, classeId: string): Promise<InscriptionSource | null> {
    const [inscription, eleve, config, tenant] = await Promise.all([
      this.prisma.inscription.findFirst({
        where: { tenantId, eleveId, classeId, statut: 'ACTIF' },
        orderBy: { createdAt: 'desc' },
        include: {
          classe: { select: { nom: true } },
          anneeAcademique: { select: { libelle: true } },
        },
      }),
      this.prisma.user.findUnique({ where: { id: eleveId }, select: { firstName: true, lastName: true, matricule: true } }),
      this.prisma.ecoleConfig.findUnique({ where: { tenantId } }),
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { nom: true, adresse: true, telephone: true, logoUrl: true } }),
    ]);

    if (!inscription) return null;

    const schoolName = config?.nom ?? tenant?.nom ?? 'EduSen';
    const words = schoolName.trim().split(/\s+/);
    const initials = (words.length >= 2 ? words[0][0] + words[1][0] : schoolName.slice(0, 2)).toUpperCase();

    return {
      numeroInscription: inscription.numeroInscription,
      anneeLibelle: inscription.anneeAcademique.libelle,
      dateInscription: inscription.createdAt,
      eleve: {
        firstName: eleve?.firstName ?? '',
        lastName: eleve?.lastName ?? '',
        matricule: eleve?.matricule ?? null,
      },
      classe: { nom: inscription.classe.nom },
      school: {
        name: schoolName,
        initials,
        address: [config?.adresse ?? tenant?.adresse, config?.ville].filter(Boolean).join(' · '),
        phone: config?.telephone ?? tenant?.telephone ?? '',
        email: config?.email ?? '',
        logoUrl: this.storage.resolveUrl(config?.logoUrl ?? tenant?.logoUrl) ?? null,
      },
    };
  }

  private renderHtml(source: InscriptionSource, fournitures: FournitureDocItem[]): string {
    const schoolContact = [source.school.address, source.school.phone, source.school.email].filter(Boolean).join(' · ');
    const eleveNom = `${source.eleve.firstName} ${source.eleve.lastName}`.trim();
    const dateStr = this.formatDate(source.dateInscription);
    const obligatoires = fournitures.filter((f) => f.obligatoire);
    const facultatives = fournitures.filter((f) => !f.obligatoire);
    const totalArticles = fournitures.length;

    const logoHtml = source.school.logoUrl
      ? `<img src="${this.esc(source.school.logoUrl)}" alt="logo" style="width:54px;height:54px;object-fit:contain;flex:none;">`
      : `<span style="width:54px;height:54px;background:#2563eb;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:19px;flex:none;">${this.esc(source.school.initials)}</span>`;

    const headerHtml = (accentColor: string) => `
      <div style="position:absolute;left:0;top:0;bottom:0;width:7px;background:${accentColor};"></div>
      <div style="padding:34px 52px 24px 60px;border-bottom:2px solid #0f172a;">
        <div style="display:flex;align-items:center;gap:16px;">
          ${logoHtml}
          <div style="min-width:0;flex:1;">
            <div style="font-size:21px;font-weight:800;color:#0f172a;letter-spacing:-.02em;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${this.esc(source.school.name)}</div>
            <div style="font-size:12px;color:#64748b;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${this.esc(schoolContact)}</div>
          </div>
        </div>
      </div>`;

    const rowHtml = (f: FournitureDocItem) =>
      `<tr>
        <td style="padding:10px 12px;font-size:13px;color:#0f172a;font-weight:500;border-bottom:1px solid #f1f5f9;">${this.esc(f.nom)}</td>
        <td style="padding:10px 12px;font-size:13px;color:#475569;text-align:center;border-bottom:1px solid #f1f5f9;">${f.quantite}</td>
        <td style="padding:10px 12px;font-size:12px;color:#64748b;border-bottom:1px solid #f1f5f9;">${this.esc(f.description ?? '')}</td>
      </tr>`;

    const tableSection = (titre: string, color: string, items: FournitureDocItem[]) =>
      items.length === 0
        ? ''
        : `<div style="margin-bottom:24px;">
        <div style="font-size:11px;font-weight:700;color:${color};letter-spacing:.12em;text-transform:uppercase;margin-bottom:8px;">${titre}</div>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;">
          <thead>
            <tr style="background:#f8fafc;">
              <th style="padding:9px 12px;font-size:11px;font-weight:600;color:#64748b;letter-spacing:.06em;text-transform:uppercase;text-align:left;border-bottom:1px solid #e2e8f0;">Article</th>
              <th style="padding:9px 12px;font-size:11px;font-weight:600;color:#64748b;letter-spacing:.06em;text-transform:uppercase;text-align:center;border-bottom:1px solid #e2e8f0;width:70px;">Qté</th>
              <th style="padding:9px 12px;font-size:11px;font-weight:600;color:#64748b;letter-spacing:.06em;text-transform:uppercase;text-align:left;border-bottom:1px solid #e2e8f0;">Remarque</th>
            </tr>
          </thead>
          <tbody>${items.map(rowHtml).join('')}</tbody>
        </table>
      </div>`;

    return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; font-family: 'Inter', Arial, sans-serif; -webkit-font-smoothing: antialiased; }
  @page { size: A4; margin: 0; }
  .page { width: 100%; min-height: 297mm; position: relative; overflow: hidden; background: #fff; page-break-after: always; }
  .page:last-child { page-break-after: auto; }
</style>
</head><body>

<!-- ───── PAGE 1 : Fiche d'inscription ───── -->
<div class="page">
  ${headerHtml('#2563eb')}
  <div style="padding:28px 52px 0 60px;">
    <div style="font-size:10px;font-weight:700;color:#2563eb;letter-spacing:.15em;text-transform:uppercase;">Fiche d'inscription</div>
    <div style="font-size:26px;font-weight:800;color:#0f172a;margin-top:6px;letter-spacing:-.02em;font-family:monospace;">${this.esc(source.numeroInscription)}</div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;margin-top:24px;">
    <div style="padding:22px 24px 22px 60px;border-right:1px solid #eef2f6;border-bottom:1px solid #eef2f6;">
      <div style="font-size:10px;font-weight:600;color:#94a3b8;letter-spacing:.09em;text-transform:uppercase;">Élève</div>
      <div style="font-size:18px;font-weight:700;color:#0f172a;margin-top:6px;">${this.esc(eleveNom)}</div>
      ${source.eleve.matricule ? `<div style="font-size:12px;color:#64748b;margin-top:4px;font-family:monospace;">Mat. ${this.esc(source.eleve.matricule)}</div>` : ''}
    </div>
    <div style="padding:22px 52px 22px 24px;border-bottom:1px solid #eef2f6;">
      <div style="font-size:10px;font-weight:600;color:#94a3b8;letter-spacing:.09em;text-transform:uppercase;">Classe affectée</div>
      <div style="font-size:18px;font-weight:700;color:#0f172a;margin-top:6px;">${this.esc(source.classe.nom)}</div>
      <div style="font-size:13px;color:#64748b;margin-top:4px;">Année ${this.esc(source.anneeLibelle)}</div>
    </div>
  </div>

  <div style="padding:24px 52px 0 60px;">
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;">
      <div>
        <div style="font-size:10px;font-weight:600;color:#94a3b8;letter-spacing:.09em;text-transform:uppercase;margin-bottom:6px;">Date d'inscription</div>
        <div style="font-size:14px;font-weight:600;color:#0f172a;">${dateStr}</div>
      </div>
      <div>
        <div style="font-size:10px;font-weight:600;color:#94a3b8;letter-spacing:.09em;text-transform:uppercase;margin-bottom:6px;">Statut</div>
        <div style="display:inline-block;background:#dcfce7;padding:4px 14px;font-size:12px;font-weight:700;color:#15803d;letter-spacing:.06em;text-transform:uppercase;">ACTIF</div>
      </div>
      <div>
        <div style="font-size:10px;font-weight:600;color:#94a3b8;letter-spacing:.09em;text-transform:uppercase;margin-bottom:6px;">Fournitures (page 2)</div>
        <div style="font-size:14px;font-weight:600;color:#2563eb;">${totalArticles} article${totalArticles !== 1 ? 's' : ''}</div>
      </div>
    </div>
  </div>

  <div style="position:absolute;bottom:40px;left:60px;right:52px;display:flex;align-items:flex-end;justify-content:space-between;">
    <div style="font-size:11px;color:#94a3b8;line-height:1.6;">Document généré électroniquement · Voir page 2 pour la liste des fournitures scolaires</div>
    <div style="text-align:center;flex:none;">
      <div style="width:84px;height:84px;border:2px dashed #cbd5e1;display:flex;align-items:center;justify-content:center;margin:0 auto;">
        <span style="font-size:8px;font-weight:700;color:#94a3b8;text-align:center;line-height:1.4;display:block;">CACHET<br>ÉCOLE</span>
      </div>
      <div style="font-size:10px;color:#94a3b8;margin-top:6px;">Administration</div>
    </div>
  </div>
</div>

<!-- ───── PAGE 2 : Liste des fournitures ───── -->
<div class="page">
  ${headerHtml('#0f172a')}
  <div style="padding:28px 52px 24px 60px;">
    <div style="font-size:10px;font-weight:700;color:#64748b;letter-spacing:.15em;text-transform:uppercase;">Fournitures scolaires</div>
    <div style="font-size:22px;font-weight:800;color:#0f172a;margin-top:4px;">Classe de ${this.esc(source.classe.nom)}</div>
    <div style="font-size:13px;color:#64748b;margin-top:4px;">Année ${this.esc(source.anneeLibelle)} &nbsp;·&nbsp; ${totalArticles} article${totalArticles !== 1 ? 's' : ''}</div>
  </div>

  <div style="padding:0 52px 32px 60px;">
    ${tableSection('Obligatoires', '#2563eb', obligatoires)}
    ${tableSection('Facultatifs', '#94a3b8', facultatives)}
    ${totalArticles === 0
      ? '<div style="padding:40px 0;text-align:center;color:#94a3b8;font-size:14px;">Aucune fourniture définie pour ce niveau.</div>'
      : ''}
  </div>

  <div style="position:absolute;bottom:40px;left:60px;right:52px;">
    <div style="font-size:11px;color:#94a3b8;">Liste établie pour l'année ${this.esc(source.anneeLibelle)}. Se référer à l'administration pour toute modification ultérieure.</div>
  </div>
</div>

</body></html>`;
  }

  private async renderPdf(html: string): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: false,
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
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const puppeteer = require('puppeteer');
      const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
      this.browserPromise = puppeteer
        .launch({
          headless: true,
          ...(executablePath ? { executablePath } : {}),
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        })
        .catch((error: unknown) => {
          this.browserPromise = null;
          throw error;
        });
    }
    return this.browserPromise;
  }

  private formatDate(d: Date | string): string {
    const date = d instanceof Date ? d : new Date(d);
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  }

  private esc(s: string): string {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
