import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@/config/prisma.service';
import { RedisService } from '@/infrastructure/redis/redis.service';
import { WhatsappService } from '@/modules/whatsapp/whatsapp.service';
import { formatMru } from '@/common/utils/currency.util';
import { mapWithConcurrency } from '@/common/utils/async.util';

/** Days after month start before declaring a payment overdue */
const OVERDUE_DAYS = 10;
/** Days before end-of-month to send the "upcoming" reminder */
const WARN_DAYS_BEFORE_MONTH_END = 5;
/** Check interval: every 24 h */
const INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Startup delay in ms */
const STARTUP_DELAY_MS = 45_000;
/** Keeps one daily scheduler run across all SaaS replicas. */
const SCHEDULER_LOCK_TTL_SECONDS = 26 * 60 * 60;

@Injectable()
export class MensualitesSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(MensualitesSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
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
    const dayKey = new Date().toISOString().slice(0, 10);
    const lockKey = `scheduler:mensualites:${dayKey}`;
    const lockResult = await this.redis.acquireLock(lockKey, `instance-${process.pid}`, SCHEDULER_LOCK_TTL_SECONDS);
    if (lockResult === 'locked') {
      this.logger.log('[MensualitesScheduler] Daily run already handled by another SaaS instance.');
      return;
    }
    if (lockResult === 'unavailable') {
      this.logger.warn('[MensualitesScheduler] Redis unavailable; running without distributed lock.');
    }

    this.logger.log('[MensualitesScheduler] Starting daily check…');
    try {
      await this.autoCreateMensualitesPaiements();
      await this.notifyOverduePaiements();
      await this.notifyUpcomingEndOfMonth();
    } catch (error) {
      // Allow a later retry when the protected run fails before completion.
      if (lockResult === 'acquired') await this.redis.del(lockKey);
      throw error;
    }
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
      select: { id: true, tenantId: true, eleveId: true },
    });

    if (!inscriptions.length) return;

    const tenantIds = [...new Set(inscriptions.map((inscription) => inscription.tenantId))];
    const studentIds = inscriptions.map((inscription) => inscription.eleveId);
    const [existing, fraisConfigs] = await Promise.all([
      this.prisma.paiement.findMany({
        where: { eleveId: { in: studentIds }, typePaiement: 'SCOLARITE', anneeScolaire, trimestre: trimestreKey },
        select: { tenantId: true, eleveId: true },
      }),
      this.prisma.fraisNiveauConfig.findMany({
        where: { tenantId: { in: tenantIds }, actif: true },
        select: { tenantId: true, mensualite: true },
      }),
    ]);
    const existingByStudent = new Set(existing.map((payment) => `${payment.tenantId}:${payment.eleveId}`));
    const mensualiteByTenant = new Map<string, number>();
    for (const config of fraisConfigs) {
      if (!mensualiteByTenant.has(config.tenantId)) {
        mensualiteByTenant.set(config.tenantId, config.mensualite ?? 0);
      }
    }

    const payments = inscriptions.flatMap((inscription) => {
      const key = `${inscription.tenantId}:${inscription.eleveId}`;
      const montant = mensualiteByTenant.get(inscription.tenantId) ?? 0;
      if (existingByStudent.has(key) || montant <= 0) return [];
      return [{
        tenantId: inscription.tenantId,
        eleveId: inscription.eleveId,
        inscriptionId: inscription.id,
        reference: `MENS-${year}${String(month).padStart(2, '0')}-${randomUUID().slice(0, 6).toUpperCase()}`,
        montant,
        typePaiement: 'SCOLARITE' as const,
        modePaiement: 'ESPECES' as const,
        statut: 'EN_ATTENTE' as const,
        anneeScolaire,
        trimestre: trimestreKey,
        description: `Mensualité ${this.monthLabel(month)} ${year}`,
      }];
    });
    const created = payments.length ? (await this.prisma.paiement.createMany({ data: payments, skipDuplicates: true })).count : 0;
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

    await mapWithConcurrency(overdue, 6, (p) =>
      this.notifyEleveAndParents(
        p.tenantId, p.eleveId, p.montant, p.anneeScolaire,
        p.description ?? p.trimestre ?? '',
        true,
      ),
    );
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

    const tenantIds = [...new Set(inscriptions.map((inscription) => inscription.tenantId))];
    const fraisConfigs = await this.prisma.fraisNiveauConfig.findMany({
      where: { tenantId: { in: tenantIds }, actif: true },
      select: { tenantId: true, mensualite: true },
    });
    const mensualiteByTenant = new Map<string, number>();
    for (const config of fraisConfigs) {
      if (!mensualiteByTenant.has(config.tenantId)) {
        mensualiteByTenant.set(config.tenantId, config.mensualite ?? 0);
      }
    }

    const recipients = inscriptions.filter((inscription) => (mensualiteByTenant.get(inscription.tenantId) ?? 0) > 0);
    await mapWithConcurrency(recipients, 6, (inscription) =>
      this.notifyEleveAndParents(
        inscription.tenantId,
        inscription.eleveId,
        mensualiteByTenant.get(inscription.tenantId)!,
        anneeScolaire,
        nextLabel,
        false,
      ),
    );
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
    const montantStr = formatMru(montant);
    const emoji = isOverdue ? '🔴' : '🔔';
    const verb = isOverdue ? 'est en retard' : 'arrive bientôt';

    const studentMsg =
      `${emoji} *Mensualité scolaire — ${periodeLabel}*\n` +
      `Bonjour ${eleve.firstName ?? ''},\n` +
      `Votre mensualité de *${montantStr}* (${anneeScolaire}) ${verb}.\n` +
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
        `La mensualité scolaire de *${nomEleve}* (${montantStr}) ${verb}.\n` +
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
