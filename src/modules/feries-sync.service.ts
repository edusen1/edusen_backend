import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AcademiqueConfigService } from '@/modules/configuration/academique-config.service';

/** Delay before first sync after startup (30 seconds) */
const STARTUP_DELAY_MS = 30_000;

/**
 * Synchronise automatiquement les jours fériés du Sénégal (via Calendarific)
 * dans le calendrier de toutes les écoles au démarrage du serveur.
 *
 * - Sync l'année en cours + l'année suivante
 * - Ne crée pas de doublons (vérifie avant insertion)
 * - Nécessite CALENDARIFIC_API_KEY dans les variables d'environnement
 */
@Injectable()
export class FeriesSyncService implements OnModuleInit {
  private readonly logger = new Logger(FeriesSyncService.name);

  constructor(private readonly academiqueConfig: AcademiqueConfigService) {}

  onModuleInit(): void {
    if (!process.env.CALENDARIFIC_API_KEY) {
      this.logger.warn('CALENDARIFIC_API_KEY non configurée — sync fériés désactivée');
      return;
    }
    setTimeout(() => void this.syncAll(), STARTUP_DELAY_MS);
  }

  private async syncAll(): Promise<void> {
    const currentYear = new Date().getFullYear();
    try {
      this.logger.log(`Synchronisation des jours fériés ${currentYear} et ${currentYear + 1}...`);
      const created1 = await this.academiqueConfig.syncFeriesSenegalAllTenants(currentYear);
      const created2 = await this.academiqueConfig.syncFeriesSenegalAllTenants(currentYear + 1);
      this.logger.log(`Sync fériés terminée — ${created1 + created2} événements créés`);
    } catch (err) {
      this.logger.error(`Erreur sync fériés: ${(err as Error).message}`);
    }
  }
}
