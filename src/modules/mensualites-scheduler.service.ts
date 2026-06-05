import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@/config/prisma.service';
import { WhatsappService } from '@/modules/whatsapp/whatsapp.service';

/** Days after month start before declaring a payment overdue */
const OVERDUE_DAYS = 10;
/** Days before end-of-month to send the "upcoming" reminder */
const WARN_DAYS_BEFORE_MONTH_END = 5;
/** Check interval: every 24 h */
const INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Startup delay in ms */
const STARTUP_DELAY_MS = 45_000;

@Injectable()
export class MensualitesSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(MensualitesSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
  ) {}

  onModuleInit(): void {
    setTimeout(() => {
      this.run().catch((e) => this.logger.error('Scheduler init run failed', e));
      setInterval(
        () => this.run().catch((e) => this.logger.error('Scheduler interval run failed', e)),
        INTERVAL_MS,
      );
    }, STARTUP_DELAY_MS);
  }

  /** Main entry point — called daily */
  async run(): Promise<void> {
    this.logger.log('[MensualitesScheduler] Starting daily check…');
    await this.autoCreateMensualitesPaiements();
    await this.notifyOverduePaiements();
    await this.notifyUpcomingEndOfMonth();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Auto-create EN_ATTENTE paiements at the start of each month (days 1-3)
  // ─────────────────────────────────────────────────────────────────────────────
  private async autoCreateMensualitesPaiements(): Promise<void> {
    const now = new Date();
    if (now.getDate() > 3) return; // only run near the 1st of the month

    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevYearShort = String(prevYear).slice(2);
    const anneeScolaire = `${prevYear}-${year}`;
    const trimestreKey = `MOIS_${String(month).padStart(2, '0')}`;

    const inscriptions = await this.prisma.inscription.findMany({
      where: { statut: 'ACTIF' },
      include: { classe: { include: { niveau: true } } },
    });

    let created = 0;
    for (const ins of inscriptions) {
      const existing = await this.prisma.paiement.findFirst({
        where: {
          tenantId: ins.tenantId,
          eleveId: ins.eleveId,
          typePaiement: 'SCOLARITE',
          anneeScolaire,
          trimestre: trimestreKey,
        },
      });
      if (existing) continue;

      // Look up frais for this niveau
      const frais = await this.prisma.fraisNiveauConfig.findFirst({
        where: { tenantId: ins.tenantId, actif: true },
      });

      const montant = frais?.mensualite ?? 0;
      if (montant <= 0) continue;

      await this.prisma.paiement.create({
        data: {
          tenantId: ins.tenantId,
          eleveId: ins.eleveId,
          inscriptionId: ins.id,
          reference: `MENS-${year}${String(month).padStart(2, '0')}-${randomUUID().slice(0, 6).toUpperCase()}`,
          montant,
          typePaiement: 'SCOLARITE',
          modePaiement: 'ESPECES',
          statut: 'EN_ATTENTE',
          anneeScolaire,
          trimestre: trimestreKey,
          description: `Mensualité ${this.monthLabel(month)} ${year}`,
        },
      });
      created++;
    }
    this.logger.log(`[MensualitesScheduler] Created ${created} new mensualité records for ${this.monthLabel(month)} ${year}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Notify eleve + parents when payment is overdue
  // ─────────────────────────────────────────────────────────────────────────────
  private async notifyOverduePaiements(): Promise<void> {
    const cutoff = new Date(Date.now() - OVERDUE_DAYS * 86_400_000);

    const overdue = await this.prisma.paiement.findMany({
      where: { statut: 'EN_ATTENTE', typePaiement: 'SCOLARITE', createdAt: { lte: cutoff } },
      select: {
        id: true, tenantId: true, eleveId: true, montant: true,
        anneeScolaire: true, trimestre: true, description: true,
      },
    });

    this.logger.log(`[MensualitesScheduler] ${overdue.length} overdue payments to notify`);

    for (const p of overdue) {
      await this.notifyEleveAndParents(
        p.tenantId, p.eleveId, p.montant, p.anneeScolaire,
        p.description ?? p.trimestre ?? '',
        true,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Upcoming warning — X days before month end
  // ─────────────────────────────────────────────────────────────────────────────
  private async notifyUpcomingEndOfMonth(): Promise<void> {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysLeft = daysInMonth - now.getDate();
    if (daysLeft !== WARN_DAYS_BEFORE_MONTH_END) return;

    const year = now.getFullYear();
    const nextMonth = now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2;
    const nextYear = now.getMonth() + 2 > 12 ? year + 1 : year;
    const nextLabel = `${this.monthLabel(nextMonth)} ${nextYear}`;
    const anneeScolaire = `${year - 1}-${year}`;

    const inscriptions = await this.prisma.inscription.findMany({
      where: { statut: 'ACTIF' },
      select: { tenantId: true, eleveId: true, classeId: true },
    });

    this.logger.log(`[MensualitesScheduler] Sending upcoming-payment warnings for ${nextLabel}`);

    const fraisCache = new Map<string, number>();
    for (const ins of inscriptions) {
      let montant = fraisCache.has(ins.tenantId) ? fraisCache.get(ins.tenantId)! : -1;
      if (montant < 0) {
        const frais = await this.prisma.fraisNiveauConfig.findFirst({
          where: { tenantId: ins.tenantId, actif: true },
        });
        montant = frais?.mensualite ?? 0;
        fraisCache.set(ins.tenantId, montant);
      }
      if (montant <= 0) continue;
      await this.notifyEleveAndParents(ins.tenantId, ins.eleveId, montant, anneeScolaire, nextLabel, false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Shared notification helper
  // ─────────────────────────────────────────────────────────────────────────────
  private async notifyEleveAndParents(
    tenantId: string,
    eleveId: string,
    montant: number,
    anneeScolaire: string,
    periodeLabel: string,
    isOverdue: boolean,
  ): Promise<void> {
    const eleve = await this.prisma.user.findUnique({
      where: { id: eleveId },
      select: { firstName: true, lastName: true, telephone: true },
    });
    if (!eleve) return;

    const parents = await this.prisma.eleveParent.findMany({
      where: { eleveId },
      include: { parent: { select: { firstName: true, telephone: true } } },
    }).catch(() => [] as any[]);

    const nomEleve = `${eleve.firstName ?? ''} ${eleve.lastName ?? ''}`.trim();
    const montantStr = Number(montant).toLocaleString('fr-FR');
    const emoji = isOverdue ? '🔴' : '🔔';
    const verb = isOverdue ? 'est en retard' : 'arrive bientôt';

    const studentMsg =
      `${emoji} *Mensualité scolaire — ${periodeLabel}*\n` +
      `Bonjour ${eleve.firstName ?? ''},\n` +
      `Votre mensualité de *${montantStr} FCFA* (${anneeScolaire}) ${verb}.\n` +
      (isOverdue
        ? `⚠️ Veuillez régulariser au plus vite auprès de la caisse de l'école.`
        : `Pensez à régler votre mensualité avant la fin du mois.`);

    if (eleve.telephone) {
      this.whatsapp.sendMessage(tenantId, eleve.telephone, studentMsg).catch(() => {});
    }

    for (const rel of parents) {
      const parent = rel.parent;
      if (!parent?.telephone) continue;
      const parentMsg =
        `${emoji} *Mensualité de ${nomEleve} — ${periodeLabel}*\n` +
        `Bonjour ${parent.firstName ?? ''},\n` +
        `La mensualité scolaire de *${nomEleve}* (${montantStr} FCFA) ${verb}.\n` +
        (isOverdue
          ? `⚠️ Merci de régulariser au plus vite à la caisse de l'école.`
          : `Merci de vous assurer du règlement avant la fin du mois.`);
      this.whatsapp.sendMessage(tenantId, parent.telephone, parentMsg).catch(() => {});
    }
  }

  private monthLabel(m: number): string {
    return ['Janvier','Février','Mars','Avril','Mai','Juin',
      'Juillet','Août','Septembre','Octobre','Novembre','Décembre'][m - 1] ?? String(m);
  }
}
