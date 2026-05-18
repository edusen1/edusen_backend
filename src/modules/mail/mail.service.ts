import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend | null;
  private readonly from: string;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    this.from = process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev';
    this.resend = apiKey ? new Resend(apiKey) : null;
  }

  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
    if (!this.resend) {
      this.logger.warn(`[MailService][sendPasswordResetEmail] RESEND_API_KEY manquante; email non envoye to=${to}`);
      return;
    }

    await this.resend.emails.send({
      from: this.from,
      to,
      subject: 'Reinitialisation de mot de passe - Noura School',
      html: `<p>Bonjour,</p><p>Cliquez ici pour reinitialiser votre mot de passe:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>Ce lien expire dans 30 minutes.</p>`,
    });
  }
}
