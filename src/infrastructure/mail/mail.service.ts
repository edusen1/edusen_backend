import { Injectable, Logger } from '@nestjs/common';

/**
 * MailService desactive — notifications via WhatsApp uniquement.
 * Toutes les methodes sont des no-op volontaires.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  sendAsync(_to: string, _subject: string, _html: string): void {
    // desactive
  }

  async send(_to: string, _subject: string, _html: string): Promise<void> {
    // desactive
  }

  sendPasswordReset(to: string, _resetUrl: string): void {
    this.logger.debug(`[Mail desactive] password reset pour ${to}`);
  }

  sendCompteCree(to: string, _prenom: string, _nom: string, _tmpPwd: string, _from?: string): void {
    this.logger.debug(`[Mail desactive] compte cree pour ${to}`);
  }

  sendBulletinDisponible(to: string, _eleveNom: string, _trimestre: string): void {
    this.logger.debug(`[Mail desactive] bulletin pour ${to}`);
  }

  sendConvocation(to: string, _parentPrenom: string, _eleveNom: string, _date: string, _motif: string): void {
    this.logger.debug(`[Mail desactive] convocation pour ${to}`);
  }

  sendNotificationPaiement(to: string, _eleveNom: string, _montant: number, _reference: string): void {
    this.logger.debug(`[Mail desactive] paiement pour ${to}`);
  }
}
