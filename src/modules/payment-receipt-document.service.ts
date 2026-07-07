import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { AsyncSemaphore } from '@/common/utils/async.util';
import { PrismaService } from '@/config/prisma.service';
import { StorageService } from '@/infrastructure/storage/storage.service';

interface PaymentReceiptSource {
  tenantId: string;
  reference: string;
  montant: number;
  typePaiement: string;
  modePaiement: string;
  anneeScolaire: string;
  trimestre?: string | null;
  datePaiement?: Date | string | null;
  description?: string | null;
  transactionId?: string | null;
  encaisseParNom?: string | null;
  encaisseParEmail?: string | null;
  reduction?: number | null;
  reductionLabel?: string | null;
  montantBrut?: number | null;
  montantNet?: number | null;
  dette?: number | null;
  paiementPrecedent?: number | null;
  eleve?: {
    firstName?: string | null;
    lastName?: string | null;
    matricule?: string | null;
    elevParents?: Array<{
      parent?: {
        id?: string;
        firstName?: string | null;
        lastName?: string | null;
        telephone?: string | null;
      } | null;
    }> | null;
  } | null;
  inscription?: {
    classe?: { nom?: string | null } | null;
  } | null;
}

interface ReceiptModel {
  school: {
    name: string;
    initials: string;
    address: string;
    phone: string;
    email: string;
    logoUrl: string | null;
  };
  payment: {
    reference: string;
    date: string;
    period: string;
    year: string;
    montantBrut: number;
    reduction: number;
    reductionLabel: string;
    montantNet: number;
    montantPaye: number;
    paiementPrecedent: number;
    dette: number;
    amountNet: string;
    typeLabel: string;
    modeLabel: string;
    description: string;
    transactionId: string | null;
    encaisseParNom: string | null;
    encaisseParEmail: string | null;
  };
  payer: {
    nom: string;
    telephone: string;
  } | null;
  student: {
    name: string;
    matricule: string;
    classe: string;
  };
}

const pdfRenderSemaphore = new AsyncSemaphore(Math.max(1, Number(process.env.PAYMENT_RECEIPT_PDF_CONCURRENCY ?? 1)));

@Injectable()
export class PaymentReceiptDocumentService implements OnModuleDestroy {
  private readonly logger = new Logger(PaymentReceiptDocumentService.name);
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
      // nothing to do
    } finally {
      this.browserPromise = null;
    }
  }

  async generate(tenantId: string, payment: PaymentReceiptSource): Promise<{ buffer: Buffer; filename: string; receiptNumber: string }> {
    const model = await this.buildModel(tenantId, payment);
    const html = this.renderHtml(model);
    const buffer = await pdfRenderSemaphore.run(() => this.renderPdf(html));
    return {
      buffer,
      filename: `recu-${this.slug(model.payment.reference)}.pdf`,
      receiptNumber: model.payment.reference,
    };
  }

  // Exposed for callers that need to enrich the source with extra fields
  static sourceFields() {
    return ['transactionId', 'encaisseParNom', 'reduction'] as const;
  }

  private async buildModel(tenantId: string, payment: PaymentReceiptSource): Promise<ReceiptModel> {
    const [config, tenant] = await Promise.all([
      this.prisma.ecoleConfig.findUnique({ where: { tenantId } }),
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { nom: true, adresse: true, telephone: true, logoUrl: true } }),
    ]);

    const schoolName = config?.nom ?? tenant?.nom ?? 'Noura School';
    const words = schoolName.trim().split(/\s+/);
    const initials = words.length >= 2 ? words[0][0] + words[1][0] : schoolName.slice(0, 2);

    const studentName = `${payment.eleve?.firstName ?? ''} ${payment.eleve?.lastName ?? ''}`.trim() || 'Élève';
    const classeName = payment.inscription?.classe?.nom ?? '';

    const parentEntry = payment.eleve?.elevParents?.[0]?.parent ?? null;
    const payer = parentEntry
      ? {
          nom: `${parentEntry.firstName ?? ''} ${parentEntry.lastName ?? ''}`.trim() || 'Parent',
          telephone: parentEntry.telephone ?? '',
        }
      : null;

    const montantPaye = Math.round(Number(payment.montant ?? 0));
    const reduction = Math.round(Number(payment.reduction ?? 0));
    const montantBrut = Math.round(Number(payment.montantBrut ?? (montantPaye + reduction)));
    const montantNet = Math.round(Number(payment.montantNet ?? (montantBrut - reduction)));
    const paiementPrecedent = Math.max(0, Math.round(Number(payment.paiementPrecedent ?? 0)));
    const dette = Math.max(0, Math.round(Number(payment.dette ?? (montantNet - paiementPrecedent - montantPaye))));

    return {
      school: {
        name: schoolName,
        initials: initials.toUpperCase(),
        address: [config?.adresse ?? tenant?.adresse, config?.ville].filter(Boolean).join(' · '),
        phone: config?.telephone ?? tenant?.telephone ?? '',
        email: config?.email ?? '',
        logoUrl: this.storage.resolveUrl(config?.logoUrl ?? tenant?.logoUrl) ?? null,
      },
      payment: {
        reference: payment.reference,
        date: this.formatDate(payment.datePaiement ?? new Date()),
        period: this.periodLabel(payment.trimestre),
        year: payment.anneeScolaire,
        montantBrut,
        reduction,
        reductionLabel: payment.reductionLabel?.trim() || 'Remise',
        montantNet,
        montantPaye,
        paiementPrecedent,
        dette,
        amountNet: this.formatFcfa(montantNet),
        typeLabel: this.paymentTypeLabel(payment.typePaiement),
        modeLabel: this.modeLabel(payment.modePaiement),
        description: payment.description?.trim() || '',
        transactionId: payment.transactionId ?? null,
        encaisseParNom: payment.encaisseParNom ?? null,
        encaisseParEmail: payment.encaisseParEmail ?? null,
      },
      payer,
      student: {
        name: studentName,
        matricule: payment.eleve?.matricule ?? '',
        classe: classeName,
      },
    };
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

  private renderHtml(model: ReceiptModel): string {
    const schoolContact = [model.school.address, model.school.phone, model.school.email].filter(Boolean).join(' · ');
    const hasReduction = model.payment.reduction > 0;
    const hasPreviousPayment = model.payment.paiementPrecedent > 0;
    const hasDebt = model.payment.dette > 0;
    const sousTotal = this.formatFcfa(model.payment.montantBrut);
    const netStr = this.formatFcfa(model.payment.montantNet);
    const periodLabel = model.payment.period || model.payment.year;
    const descLabel = model.payment.description || model.payment.typeLabel;

    const logoHtml = model.school.logoUrl
      ? `<img src="${this.escape(model.school.logoUrl)}" alt="logo" style="width:54px;height:54px;object-fit:contain;flex:none;">`
      : `<span style="width:54px;height:54px;background:#2563eb;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:19px;flex:none;">${this.escape(model.school.initials)}</span>`;

    const payerBlock = model.payer
      ? `<div style="font-size:16px;font-weight:700;color:#0f172a;margin-top:6px;">${this.escape(model.payer.nom)}</div>
         <div style="font-size:12px;color:#64748b;margin-top:2px;">Parent / Tuteur</div>
         ${model.payer.telephone ? `<div style="font-size:13px;color:#475569;font-family:'JetBrains Mono',monospace;margin-top:4px;">${this.escape(model.payer.telephone)}</div>` : ''}`
      : `<div style="font-size:14px;font-weight:600;color:#475569;margin-top:6px;">—</div>`;

    const studentSubLine = [model.student.classe, model.payment.year].filter(Boolean).join(' · ');

    return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; font-family: 'Inter', Arial, sans-serif; -webkit-font-smoothing: antialiased; }
  @page { size: A4; margin: 0; }
</style>
</head><body>
<div style="width:100%;min-height:100vh;background:#fff;position:relative;overflow:hidden;">

  <!-- accent edge -->
  <div style="position:absolute;left:0;top:0;bottom:0;width:7px;background:#2563eb;"></div>

  <!-- header -->
  <div style="padding:34px 52px 24px 60px;border-bottom:2px solid #0f172a;">
    <div style="display:flex;align-items:center;gap:16px;min-width:0;">
      ${logoHtml}
      <div style="min-width:0;flex:1;">
        <div style="font-size:21px;font-weight:800;color:#0f172a;letter-spacing:-.02em;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${this.escape(model.school.name)}</div>
        <div style="font-size:12px;color:#64748b;margin-top:4px;line-height:1.45;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${this.escape(schoolContact)}</div>
      </div>
    </div>
    <div style="margin-top:18px;padding-top:14px;border-top:1px solid #e2e8f0;display:flex;align-items:flex-start;justify-content:space-between;gap:20px;">
      <div>
        <div style="font-size:10px;font-weight:700;color:#2563eb;letter-spacing:.15em;text-transform:uppercase;line-height:1.4;">Reçu de paiement</div>
        <div style="font-size:18px;font-weight:800;color:#0f172a;margin-top:6px;font-family:'JetBrains Mono',monospace;letter-spacing:.02em;line-height:1.25;">${this.escape(model.payment.reference)}</div>
      </div>
      <div style="text-align:right;font-size:12px;color:#64748b;line-height:1.35;">Émis le<br><strong style="color:#0f172a;">${this.escape(model.payment.date)}</strong></div>
    </div>
  </div>

  <!-- payer / student row -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;">
    <div style="padding:24px 52px 24px 60px;border-right:1px solid #eef2f6;border-bottom:1px solid #eef2f6;">
      <div style="font-size:10px;font-weight:600;color:#94a3b8;letter-spacing:.09em;text-transform:uppercase;">Reçu de</div>
      ${payerBlock}
    </div>
    <div style="padding:24px 52px;border-bottom:1px solid #eef2f6;">
      <div style="font-size:10px;font-weight:600;color:#94a3b8;letter-spacing:.09em;text-transform:uppercase;">Pour l'élève</div>
      <div style="font-size:16px;font-weight:700;color:#0f172a;margin-top:6px;">${this.escape(model.student.name)}</div>
      ${studentSubLine ? `<div style="font-size:13px;color:#475569;margin-top:2px;">${this.escape(studentSubLine)}</div>` : ''}
      ${model.student.matricule ? `<div style="font-size:13px;color:#64748b;font-family:'JetBrains Mono',monospace;margin-top:4px;">Mat. ${this.escape(model.student.matricule)}</div>` : ''}
    </div>
  </div>

  <!-- line items -->
  <div style="padding:30px 52px 10px 60px;">
    <div style="display:flex;align-items:center;padding:0 0 12px;border-bottom:1px solid #e2e8f0;font-size:10px;font-weight:600;color:#94a3b8;letter-spacing:.07em;text-transform:uppercase;">
      <span style="flex:1;">Désignation</span>
      <span style="width:100px;text-align:center;">Période</span>
      <span style="width:140px;text-align:right;">Montant</span>
    </div>
    <div style="display:flex;align-items:center;padding:17px 0;border-bottom:1px solid #f1f5f9;">
      <div style="flex:1;">
        <div style="font-size:15px;font-weight:700;color:#0f172a;">${this.escape(model.payment.typeLabel)}</div>
        ${descLabel ? `<div style="font-size:12px;color:#94a3b8;margin-top:3px;">${this.escape(descLabel)}</div>` : ''}
      </div>
      <span style="width:100px;text-align:center;font-size:13px;color:#475569;">${this.escape(periodLabel)}</span>
      <span style="width:140px;text-align:right;font-size:15px;font-weight:700;color:#0f172a;font-family:'JetBrains Mono',monospace;">${this.numFcfa(model.payment.montantBrut)}</span>
    </div>
    ${hasReduction ? `
    <div style="display:flex;align-items:center;padding:17px 0;border-bottom:1px solid #f1f5f9;">
      <div style="flex:1;">
        <div style="font-size:15px;font-weight:700;color:#16a34a;">${this.escape(model.payment.reductionLabel)}</div>
      </div>
      <span style="width:100px;text-align:center;font-size:13px;color:#475569;"></span>
      <span style="width:140px;text-align:right;font-size:15px;font-weight:700;color:#16a34a;font-family:'JetBrains Mono',monospace;">– ${this.numFcfa(model.payment.reduction)}</span>
    </div>` : ''}
    ${hasPreviousPayment ? `
    <div style="display:flex;align-items:center;padding:17px 0;border-bottom:1px solid #f1f5f9;">
      <div style="flex:1;">
        <div style="font-size:15px;font-weight:700;color:#475569;">Premier paiement</div>
      </div>
      <span style="width:100px;text-align:center;font-size:13px;color:#475569;"></span>
      <span style="width:140px;text-align:right;font-size:15px;font-weight:700;color:#475569;font-family:'JetBrains Mono',monospace;">– ${this.numFcfa(model.payment.paiementPrecedent)}</span>
    </div>
    <div style="display:flex;align-items:center;padding:17px 0;border-bottom:1px solid #f1f5f9;">
      <div style="flex:1;">
        <div style="font-size:15px;font-weight:700;color:#2563eb;">Remboursement dette</div>
      </div>
      <span style="width:100px;text-align:center;font-size:13px;color:#475569;"></span>
      <span style="width:140px;text-align:right;font-size:15px;font-weight:700;color:#2563eb;font-family:'JetBrains Mono',monospace;">– ${this.numFcfa(model.payment.montantPaye)}</span>
    </div>` : ''}
  </div>

  <!-- totals -->
  <div style="padding:4px 52px 0 60px;display:flex;justify-content:flex-end;">
    <div style="width:320px;">
      <div style="display:flex;justify-content:space-between;padding:8px 0;font-size:13px;color:#475569;border-bottom:1px solid #e2e8f0;">
        <span>Sous-total</span><span style="font-family:'JetBrains Mono',monospace;">${this.escape(sousTotal)}</span>
      </div>
      ${hasReduction ? `
      <div style="display:flex;justify-content:space-between;padding:8px 0;font-size:13px;color:#16a34a;border-bottom:1px solid #e2e8f0;">
        <span>${this.escape(model.payment.reductionLabel)}</span><span style="font-family:'JetBrains Mono',monospace;">- ${this.escape(this.formatFcfa(model.payment.reduction))}</span>
      </div>` : ''}
      <div style="display:flex;justify-content:space-between;padding:8px 0;font-size:13px;color:#475569;border-bottom:1px solid #e2e8f0;">
        <span>Net à payer</span><span style="font-family:'JetBrains Mono',monospace;">${this.escape(netStr)}</span>
      </div>
      ${hasPreviousPayment ? `
      <div style="display:flex;justify-content:space-between;padding:8px 0;font-size:13px;color:#475569;border-bottom:1px solid #e2e8f0;">
        <span>Premier paiement</span><span style="font-family:'JetBrains Mono',monospace;">- ${this.escape(this.formatFcfa(model.payment.paiementPrecedent))}</span>
      </div>` : ''}
      ${hasDebt ? `
      <div style="display:flex;justify-content:space-between;padding:8px 0;font-size:13px;color:#dc2626;border-bottom:1px solid #fecaca;">
        <span>Dette restante</span><span style="font-family:'JetBrains Mono',monospace;font-weight:700;">${this.escape(this.formatFcfa(model.payment.dette))}</span>
      </div>` : ''}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;background:#0f172a;padding:16px 20px;">
        <span style="font-size:12px;font-weight:600;color:#94a3b8;letter-spacing:.06em;text-transform:uppercase;">Total payé</span>
        <span style="font-size:22px;font-weight:800;color:#fff;font-family:'JetBrains Mono',monospace;">${this.numFcfa(model.payment.montantPaye)} <span style="font-size:13px;color:#64748b;font-weight:600;">FCFA</span></span>
      </div>
    </div>
  </div>

  <!-- payment meta -->
  <div style="padding:30px 52px 0 60px;display:grid;grid-template-columns:repeat(3,1fr);gap:20px;">
    <div>
      <div style="font-size:10px;font-weight:600;color:#94a3b8;letter-spacing:.08em;text-transform:uppercase;">Mode de paiement</div>
      <div style="font-size:14px;font-weight:700;color:#0f172a;margin-top:5px;">${this.escape(model.payment.modeLabel)}</div>
    </div>
    <div>
      <div style="font-size:10px;font-weight:600;color:#94a3b8;letter-spacing:.08em;text-transform:uppercase;">Référence transaction</div>
      <div style="font-size:13px;font-weight:700;color:#0f172a;margin-top:5px;font-family:'JetBrains Mono',monospace;">${this.escape(model.payment.transactionId ?? '—')}</div>
    </div>
    <div>
      <div style="font-size:10px;font-weight:600;color:#94a3b8;letter-spacing:.08em;text-transform:uppercase;">Encaissé par</div>
      <div style="font-size:14px;font-weight:700;color:#0f172a;margin-top:5px;">${this.escape(model.payment.encaisseParNom ?? '—')}</div>
      ${model.payment.encaisseParEmail ? `<div style="font-size:11px;color:#64748b;font-family:'JetBrains Mono',monospace;margin-top:3px;">${this.escape(model.payment.encaisseParEmail)}</div>` : ''}
    </div>
  </div>

  <!-- footer -->
  <div style="padding:32px 52px 40px 60px;margin-top:28px;display:flex;align-items:flex-end;justify-content:space-between;gap:24px;">
    <div style="display:flex;align-items:center;gap:16px;">
      <span style="display:inline-flex;align-items:center;gap:8px;background:${hasDebt ? '#fef3c7' : '#dcfce7'};padding:10px 16px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${hasDebt ? '#d97706' : '#16a34a'}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${hasDebt ? '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/>' : '<path d="M20 6 9 17l-5-5"/>'}</svg>
        <span style="font-size:13px;font-weight:700;color:${hasDebt ? '#b45309' : '#15803d'};letter-spacing:.04em;">${hasDebt ? 'PAIEMENT PARTIEL' : 'PAYÉ'}</span>
      </span>
      <div style="font-size:11px;color:#94a3b8;line-height:1.6;max-width:280px;">Reçu généré électroniquement. Conservez-le comme preuve de paiement.</div>
    </div>
    <div style="text-align:center;flex:none;">
      <div style="width:84px;height:84px;border:2px dashed #cbd5e1;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto;">
        <span style="font-size:9px;font-weight:700;color:#94a3b8;text-align:center;line-height:1.3;transform:rotate(-12deg);">CACHET<br>ÉCOLE</span>
      </div>
      <div style="font-size:10px;color:#94a3b8;margin-top:6px;">Service comptabilité</div>
    </div>
  </div>

</div>
</body></html>`;
  }

  private paymentTypeLabel(value: string): string {
    const labels: Record<string, string> = {
      SCOLARITE: 'Scolarité',
      INSCRIPTION: 'Inscription',
      CANTINE: 'Cantine',
      TRANSPORT: 'Transport',
      AUTRE: 'Autre',
    };
    return labels[value] ?? value.replace(/_/g, ' ');
  }

  private periodLabel(value?: string | null): string {
    const raw = String(value ?? '').trim();
    const month = Number(raw.replace('MOIS_', ''));
    if (raw.startsWith('MOIS_') && Number.isFinite(month) && month >= 1 && month <= 12) {
      return ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'][month - 1];
    }
    return raw.replace(/_/g, ' ');
  }

  private modeLabel(value: string): string {
    const labels: Record<string, string> = {
      ESPECES: 'Espèces',
      VIREMENT: 'Virement bancaire',
      CHEQUE: 'Chèque',
      MOBILE_MONEY: 'Mobile Money',
      CARTE: 'Carte bancaire',
    };
    return labels[value] ?? value.replace(/_/g, ' ');
  }

  private formatDate(value: Date | string): string {
    const date = value instanceof Date ? value : new Date(value);
    return new Intl.DateTimeFormat('fr-FR').format(date);
  }

  private formatFcfa(value: number): string {
    return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(Number(value ?? 0)))} FCFA`;
  }

  private numFcfa(value: number): string {
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(Number(value ?? 0)));
  }

  private slug(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/(^-|-$)/g, '')
      .toLowerCase() || 'document';
  }

  private escape(value: string): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
