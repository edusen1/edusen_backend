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
    slogan: string;
    address: string;
    city: string;
    phone: string;
    logoUrl: string | null;
  };
  payment: {
    reference: string;
    date: string;
    period: string;
    year: string;
    amount: string;
    typeLabel: string;
    modeLabel: string;
    description: string;
  };
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

  private async buildModel(tenantId: string, payment: PaymentReceiptSource): Promise<ReceiptModel> {
    const [config, tenant] = await Promise.all([
      this.prisma.ecoleConfig.findUnique({ where: { tenantId } }),
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { nom: true, adresse: true, telephone: true, logoUrl: true } }),
    ]);

    const studentName = `${payment.eleve?.firstName ?? ''} ${payment.eleve?.lastName ?? ''}`.trim() || 'Élève';
    const classeName = payment.inscription?.classe?.nom ?? 'Classe non renseignée';
    return {
      school: {
        name: config?.nom ?? tenant?.nom ?? 'Noura School',
        slogan: config?.slogan ?? '',
        address: config?.adresse ?? tenant?.adresse ?? '',
        city: config?.ville ?? '',
        phone: config?.telephone ?? tenant?.telephone ?? '',
        logoUrl: this.storage.resolveUrl(config?.logoUrl ?? tenant?.logoUrl) ?? null,
      },
      payment: {
        reference: payment.reference,
        date: this.formatDate(payment.datePaiement ?? new Date()),
        period: payment.trimestre ?? payment.description ?? 'Période non renseignée',
        year: payment.anneeScolaire,
        amount: this.formatMru(payment.montant),
        typeLabel: this.paymentTypeLabel(payment.typePaiement),
        modeLabel: this.modeLabel(payment.modePaiement),
        description: payment.description?.trim() || 'Paiement validé',
      },
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
      await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        format: 'A4',
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
    const logo = model.school.logoUrl
      ? `<img src="${this.escape(model.school.logoUrl)}" alt="Logo">`
      : `<span>${this.escape(model.school.name.slice(0, 1).toUpperCase() || 'N')}</span>`;

    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
      @page { size: A4; margin: 0; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #152033; background: #fff; }
      .page { width: 210mm; min-height: 297mm; padding: 12mm; }
      .header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12mm; padding-bottom: 5mm; border-bottom: 2px solid #16824b; }
      .brand { display: flex; align-items: flex-start; gap: 5mm; }
      .logo { width: 22mm; height: 22mm; border: 1px solid #dfe3e8; border-radius: 4mm; display: flex; align-items: center; justify-content: center; overflow: hidden; font-size: 18px; font-weight: 800; color: #16824b; }
      .logo img { width: 100%; height: 100%; object-fit: contain; }
      h1 { margin: 0; font-size: 20px; line-height: 1.1; }
      .slogan { margin: 2mm 0 0; color: #16824b; font-weight: 700; }
      .contact { margin: 1mm 0 0; font-size: 11px; color: #5b6573; line-height: 1.5; }
      .receipt-box { min-width: 62mm; text-align: right; }
      .receipt-box strong { display: block; font-size: 19px; }
      .receipt-box small { display: block; margin-top: 2mm; color: #667085; }
      .badge { display: inline-block; padding: 2.5mm 4mm; border-radius: 999px; background: #eefbf3; color: #148343; font-weight: 800; font-size: 11px; }
      .title { margin: 10mm 0 6mm; text-align: center; }
      .title h2 { margin: 0; font-size: 18px; letter-spacing: 0.4px; }
      .title p { margin: 2mm 0 0; color: #667085; }
      .grid { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 7mm; }
      .card { padding: 6mm; border: 1px solid #dbe3ec; border-radius: 3mm; background: #f8fafc; }
      .card h3 { margin: 0 0 4mm; font-size: 13px; }
      .row { display: flex; justify-content: space-between; gap: 6mm; margin: 0 0 3mm; font-size: 12px; line-height: 1.45; }
      .row strong { color: #101828; }
      .amount { margin-top: 4mm; padding: 5mm; border-radius: 3mm; background: #eefbf3; border: 1px solid #ccefd9; }
      .amount .label { color: #166534; font-size: 11px; font-weight: 800; text-transform: uppercase; }
      .amount .value { margin-top: 2mm; color: #148343; font-size: 22px; font-weight: 800; }
      .signature-area { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; margin-top: 14mm; }
      .signature { min-height: 28mm; padding-top: 8mm; text-align: center; border-top: 1px solid #cdd6e1; color: #475467; }
      .signature strong { display: block; margin-bottom: 2mm; color: #101828; }
      .footer { margin-top: 10mm; padding-top: 4mm; border-top: 1px solid #dbe3ec; text-align: center; color: #667085; font-size: 10px; line-height: 1.5; }
      .muted { color: #667085; }
      @media print { .page { page-break-after: avoid; } }
    </style></head><body><main class="page">
      <header class="header">
        <div class="brand">
          <div class="logo">${logo}</div>
          <div>
            <h1>${this.escape(model.school.name)}</h1>
            ${model.school.slogan ? `<p class="slogan">${this.escape(model.school.slogan)}</p>` : ''}
            <p class="contact">${this.escape(model.school.address || '')}${model.school.city ? ` · ${this.escape(model.school.city)}` : ''}${model.school.phone ? ` · ${this.escape(model.school.phone)}` : ''}</p>
          </div>
        </div>
        <div class="receipt-box">
          <strong>RECU DE PAIEMENT</strong>
          <span class="badge">N° ${this.escape(model.payment.reference)}</span>
          <small>${this.escape(model.payment.date)}</small>
        </div>
      </header>

      <section class="title">
        <h2>Confirmation de paiement</h2>
        <p>${this.escape(model.payment.description)}</p>
      </section>

      <section class="grid">
        <article class="card">
          <h3>Informations de l'élève</h3>
          <div class="row"><span>Nom</span><strong>${this.escape(model.student.name)}</strong></div>
          ${model.student.matricule ? `<div class="row"><span>Matricule</span><strong>${this.escape(model.student.matricule)}</strong></div>` : ''}
          <div class="row"><span>Classe</span><strong>${this.escape(model.student.classe)}</strong></div>
          <div class="row"><span>Année scolaire</span><strong>${this.escape(model.payment.year)}</strong></div>
          <div class="row"><span>Période</span><strong>${this.escape(model.payment.period)}</strong></div>
        </article>

        <article class="card">
          <h3>Détails du règlement</h3>
          <div class="row"><span>Référence</span><strong>${this.escape(model.payment.reference)}</strong></div>
          <div class="row"><span>Type</span><strong>${this.escape(model.payment.typeLabel)}</strong></div>
          <div class="row"><span>Mode</span><strong>${this.escape(model.payment.modeLabel)}</strong></div>
          <div class="row"><span>Date</span><strong>${this.escape(model.payment.date)}</strong></div>
          <div class="amount">
            <div class="label">Montant payé</div>
            <div class="value">${this.escape(model.payment.amount)}</div>
          </div>
        </article>
      </section>

      <section class="signature-area">
        <div class="signature">
          <strong>Signature du caissier</strong>
          <span class="muted">Validation du paiement</span>
        </div>
        <div class="signature">
          <strong>Cachet de l'école</strong>
          <span class="muted">Document officiel</span>
        </div>
      </section>

      <footer class="footer">
        Merci de votre confiance · Reçu généré automatiquement le ${this.escape(model.payment.date)}
      </footer>
    </main></body></html>`;
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

  private formatMru(value: number): string {
    return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(Number(value ?? 0)))} MRU`;
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
