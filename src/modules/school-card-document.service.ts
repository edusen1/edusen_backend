import { Injectable, Logger, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { AsyncSemaphore } from '@/common/utils/async.util';
import { PrismaService } from '@/config/prisma.service';
import { StorageService } from '@/infrastructure/storage/storage.service';
import * as QRCode from 'qrcode';

interface SchoolCardModel {
  school: {
    name: string;
    sub: string;
    logoUrl: string | null;
    website: string;
    annee: string;
    validUntil: string;
  };
  user: {
    id: string;
    name: string;
    role: string;
    roleLabel: string;
    matricule: string;
    dateNaissance: string;
    lieuNaissance: string;
    genre: string;
    photoUrl: string | null;
    numeroUrgence: string;
    classe: string;
    cycle: string;
  };
  parent: { nom: string; telephone: string } | null;
  card: {
    title: string;
    issuedAt: string;
    qrDataUrl: string;
  };
}

const semaphore = new AsyncSemaphore(Math.max(1, Number(process.env.SCHOOL_CARD_RENDER_CONCURRENCY ?? 1)));

@Injectable()
export class SchoolCardDocumentService implements OnModuleDestroy {
  private readonly logger = new Logger(SchoolCardDocumentService.name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private browserPromise: Promise<any> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async onModuleDestroy(): Promise<void> {
    if (!this.browserPromise) return;
    try { const b = await this.browserPromise; await b.close(); } catch { /* ignore */ } finally { this.browserPromise = null; }
  }

  async generateForUser(
    tenantId: string,
    userId: string,
    options: { inscriptionId?: string | null } = {},
  ): Promise<{ cardUrl: string; cardImageUrl: string; cardPdfUrl: string; cardVersoUrl: string | null; filename: string; qrPayload: Record<string, unknown> }> {
    void options;
    const { model, qrPayload } = await this.buildModel(tenantId, userId);
    const annee = new Date().getFullYear().toString();
    const slug = this.slug(model.user.name || model.user.id);

    const buffer = await semaphore.run(() => this.renderImage(this.renderCard(model)));

    const key = this.storage.buildDocumentKey(tenantId, 'cartes-scolaires', annee, userId, `carte-${slug}.png`);
    const uploaded = await this.storage.upload(key, buffer, 'image/png');
    const cardUrl = this.storage.resolveUrl(uploaded) ?? this.storage.buildPublicAccessUrl(uploaded);

    return { cardUrl, cardImageUrl: cardUrl, cardPdfUrl: cardUrl, cardVersoUrl: null, filename: `carte-${slug}.png`, qrPayload };
  }

  // ─── Build model ────────────────────────────────────────────────────────────

  private async buildModel(tenantId: string, userId: string): Promise<{ model: SchoolCardModel; qrPayload: Record<string, unknown> }> {
    const [config, tenant, user, inscription, parentLink] = await Promise.all([
      this.prisma.ecoleConfig.findUnique({ where: { tenantId } }),
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { nom: true, logoUrl: true } }),
      this.prisma.user.findFirst({
        where: { id: userId, tenantId },
        select: { id: true, firstName: true, lastName: true, email: true, role: true, matricule: true, dateNaissance: true, lieuNaissance: true, genre: true, photoUrl: true, numeroUrgence: true },
      }),
      this.prisma.inscription.findFirst({
        where: { tenantId, eleveId: userId, statut: 'ACTIF' },
        orderBy: { createdAt: 'desc' },
        include: {
          classe: { select: { nom: true, niveau: { select: { libelle: true, cycle: { select: { libelle: true } } } } } },
          anneeAcademique: { select: { libelle: true } },
        },
      }),
      this.prisma.eleveParent.findFirst({
        where: { eleveId: userId },
        include: { parent: { select: { firstName: true, lastName: true, telephone: true } } },
      }),
    ]);

    if (!user) throw new NotFoundException('Utilisateur introuvable');

    const issuedAt = new Date().toISOString();
    const qrPayload = { type: 'NOURASCHOOL_ID_CARD', tenantId, userId: user.id, role: user.role, matricule: user.matricule ?? null, issuedAt };
    const qrDataUrl = await QRCode.toDataURL(JSON.stringify(qrPayload), { width: 220, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } });

    const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || 'Élève';
    const anneeLibelle = inscription?.anneeAcademique?.libelle ?? this.currentAnnee();
    const [anneeStart] = anneeLibelle.split(/[-–]/);
    const endYear = Number((anneeStart ?? '').trim()) + 1 || new Date().getFullYear() + 1;

    const schoolSub = [config?.ville, config?.pays].filter(Boolean).join(', ') || 'Établissement privé';

    const model: SchoolCardModel = {
      school: {
        name: config?.nom ?? tenant?.nom ?? 'Noura School',
        sub: schoolSub,
        logoUrl: this.storage.resolveUrl(config?.logoUrl ?? tenant?.logoUrl) ?? null,
        website: config?.siteWeb ?? '',
        annee: anneeLibelle,
        validUntil: `31/07/${endYear}`,
      },
      user: {
        id: user.id,
        name,
        role: user.role,
        roleLabel: this.roleLabel(user.role),
        matricule: user.matricule ?? '',
        dateNaissance: user.dateNaissance ? this.formatDate(user.dateNaissance) : '',
        lieuNaissance: user.lieuNaissance ?? '',
        genre: user.genre === 'M' ? 'Masculin' : user.genre === 'F' ? 'Féminin' : '',
        photoUrl: this.storage.resolveUrl(user.photoUrl) ?? null,
        numeroUrgence: user.numeroUrgence ?? '',
        classe: inscription?.classe?.nom ?? '',
        cycle: inscription?.classe?.niveau?.cycle?.libelle ?? inscription?.classe?.niveau?.libelle ?? '',
      },
      parent: parentLink?.parent ? {
        nom: `${parentLink.parent.firstName ?? ''} ${parentLink.parent.lastName ?? ''}`.trim(),
        telephone: parentLink.parent.telephone ?? '',
      } : null,
      card: { title: user.role === 'ELEVE' ? 'CARTE ÉLÈVE' : 'BADGE PERSONNEL', issuedAt: this.formatDate(issuedAt), qrDataUrl },
    };
    return { model, qrPayload };
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  private renderCard(m: SchoolCardModel): string {
    const logo = m.school.logoUrl
      ? `<img src="${this.e(m.school.logoUrl)}" alt="logo">`
      : `<span class="logo-i">${this.e(m.school.name.slice(0, 2).toUpperCase())}</span>`;
    const photo = m.user.photoUrl
      ? `<img src="${this.e(m.user.photoUrl)}" alt="photo">`
      : `<span class="ph-i">${this.e(m.user.name.slice(0, 1).toUpperCase())}</span>`;

    const infoGrid = [
      m.user.matricule     ? `<div><div class="lbl">Matricule</div><div class="val mono">${this.e(m.user.matricule)}</div></div>` : '',
      m.user.dateNaissance ? `<div><div class="lbl">Né(e) le</div><div class="val">${this.e(m.user.dateNaissance)}</div></div>` : '',
      m.user.lieuNaissance ? `<div><div class="lbl">Lieu</div><div class="val">${this.e(m.user.lieuNaissance)}</div></div>` : '',
      m.user.genre         ? `<div><div class="lbl">Sexe</div><div class="val">${this.e(m.user.genre)}</div></div>` : '',
    ].filter(Boolean).join('');

    const parentBlock = m.parent ? `
      <div class="cnt-item">
        <span class="clbl">Tuteur</span>
        <span class="cval">${this.e(m.parent.nom)}</span>
        ${m.parent.telephone ? `<span class="cphone">${this.e(m.parent.telephone)}</span>` : ''}
      </div>` : '';

    const urgenceBlock = m.user.numeroUrgence ? `
      <div class="cnt-item">
        <span class="clbl">Urgence</span>
        <span class="cphone red">${this.e(m.user.numeroUrgence)}</span>
      </div>` : '';

    return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;background:transparent;-webkit-font-smoothing:antialiased}
.card{width:540px;height:340px;background:#fff;overflow:hidden;display:flex;flex-direction:column}
.top{height:68px;flex:none;background:#0f172a;display:flex;align-items:center;padding:0 24px;gap:13px;position:relative;overflow:hidden}
.c1{position:absolute;right:-40px;top:-40px;width:160px;height:160px;background:#2563eb;opacity:.22;border-radius:50%}
.c2{position:absolute;right:36px;bottom:-60px;width:120px;height:120px;background:#2563eb;opacity:.16;border-radius:50%}
.logo{width:40px;height:40px;background:#2563eb;display:flex;align-items:center;justify-content:center;overflow:hidden;flex:none;z-index:1}
.logo img{width:100%;height:100%;object-fit:contain}
.logo-i{font-size:14px;font-weight:800;color:#fff}
.sch{z-index:1}
.sch-name{font-size:16px;font-weight:800;color:#fff;letter-spacing:-.01em;line-height:1.05}
.sch-sub{font-size:10px;color:#93c5fd;font-weight:500;margin-top:2px}
.clabel{margin-left:auto;text-align:right;z-index:1}
.clabel-t{font-size:10px;color:#93c5fd;font-weight:600;letter-spacing:.08em}
.body{flex:1;display:flex;padding:16px 24px 14px;gap:18px}
.pcol{flex:none;width:82px}
.photo{width:82px;height:104px;border:1px solid #e2e8f0;background:#f1f5f9;overflow:hidden;display:flex;align-items:center;justify-content:center}
.photo img{width:100%;height:100%;object-fit:cover}
.ph-i{font-size:30px;font-weight:900;color:#94a3b8}
.icol{flex:1;display:flex;flex-direction:column;min-width:0}
.sname{font-size:20px;font-weight:800;color:#0f172a;letter-spacing:-.02em;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.grid{margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:8px 14px}
.lbl{font-size:9px;font-weight:600;color:#94a3b8;letter-spacing:.07em;text-transform:uppercase}
.val{font-size:12px;font-weight:700;color:#0f172a;margin-top:2px}
.mono{font-family:'Courier New',monospace}
.sep{height:1px;background:#e2e8f0;margin:10px 0}
.contacts{display:flex;flex-direction:column;gap:6px}
.cnt-item{display:flex;flex-direction:column;gap:1px}
.clbl{font-size:9px;font-weight:600;color:#94a3b8;letter-spacing:.06em;text-transform:uppercase}
.cval{font-size:12px;font-weight:700;color:#0f172a}
.cphone{font-size:11px;color:#475569;font-family:'Courier New',monospace;margin-top:1px}
.cphone.red{color:#dc2626;font-weight:700}
.qrcol{flex:none;display:flex;flex-direction:column;align-items:center;justify-content:center}
.qrframe{width:104px;height:104px;border:1px solid #e2e8f0;padding:6px;background:#fff}
.qrframe img{width:100%;height:100%;display:block}
.foot{flex:none;padding:0 24px 10px;display:flex;align-items:center;justify-content:space-between}
.cond{font-size:8.5px;color:#94a3b8;line-height:1.45;max-width:340px}
.website{font-size:9px;font-weight:700;color:#475569;flex:none}
</style></head><body>
<div class="card">
  <div class="top">
    <div class="c1"></div><div class="c2"></div>
    <div class="logo">${logo}</div>
    <div class="sch">
      <div class="sch-name">${this.e(m.school.name)}</div>
      <div class="sch-sub">${this.e(m.school.sub)}</div>
    </div>
    <div class="clabel">
      <div class="clabel-t">${this.e(m.card.title)}</div>
    </div>
  </div>
  <div class="body">
    <div class="pcol">
      <div class="photo">${photo}</div>
    </div>
    <div class="icol">
      <div class="sname">${this.e(m.user.name)}</div>
      <div class="grid">${infoGrid}</div>
      ${(parentBlock || urgenceBlock) ? `<div class="sep"></div><div class="contacts">${parentBlock}${urgenceBlock}</div>` : ''}
    </div>
    <div class="qrcol">
      <div class="qrframe"><img src="${this.e(m.card.qrDataUrl)}" alt="QR"></div>
    </div>
  </div>
  <div class="foot">
    <div class="cond">Carte strictement personnelle. En cas de perte, prévenir l'administration. Présentation obligatoire à l'entrée.</div>
    ${m.school.website ? `<div class="website">${this.e(m.school.website)}</div>` : ''}
  </div>
</div>
</body></html>`;
  }

  // ─── Puppeteer ──────────────────────────────────────────────────────────────

  private async renderImage(html: string): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 560, height: 360, deviceScaleFactor: 3 });
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const card = await page.$('.card');
      const image = card
        ? await card.screenshot({ type: 'png' })
        : await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 540, height: 340 } });
      return Buffer.from(image);
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
      }).catch((error: unknown) => { this.browserPromise = null; throw error; });
    }
    return this.browserPromise;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private currentAnnee(): string {
    const now = new Date();
    const y = now.getFullYear();
    return now.getMonth() >= 7 ? `${y}–${y + 1}` : `${y - 1}–${y}`;
  }

  private roleLabel(role: string): string {
    const labels: Record<string, string> = {
      ELEVE: 'Élève', PROFESSEUR: 'Professeur', ADMIN: 'Administration',
      RH: 'Ressources humaines', COMPTABLE: 'Comptable',
      CAISSIER: 'Caissier', SURVEILLANT: 'Surveillant', PARENT: 'Parent',
    };
    return labels[role] ?? role;
  }

  private formatDate(value: Date | string): string {
    return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
  }

  private slug(input: string): string {
    return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'carte';
  }

  private e(value: unknown): string {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
}
