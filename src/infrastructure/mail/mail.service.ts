import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend | null;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (apiKey) {
      this.resend = new Resend(apiKey);
    } else {
      this.resend = null;
      this.logger.warn('[MailService] RESEND_API_KEY absent — emails désactivés');
    }
    this.from = this.config.get<string>('RESEND_FROM', 'EduSen <noreply@edusen.minifootapp.com>');
  }

  private wrap(body: string): string {
    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>EduSen</title>
</head>
<body style="margin:0;padding:0;background-color:#F0F4FF;font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F0F4FF;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
        <tr>
          <td style="background:#1E40AF;padding:28px 32px;text-align:center;">
            <div style="font-size:24px;font-weight:900;color:#ffffff;letter-spacing:1px;">EDUSEN</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.7);margin-top:4px;letter-spacing:0.5px;">Gestion scolaire intelligente</div>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            ${body}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;background:#f9f9f9;border-top:1px solid #e5e7eb;text-align:center;">
            <div style="font-size:11px;color:#9ca3af;line-height:1.6;">
              EduSen &mdash; Plateforme de gestion scolaire<br/>
              <a href="https://edusen.minifootapp.com" style="color:#1E40AF;text-decoration:none;">edusen.minifootapp.com</a>
            </div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  private async sendRaw(to: string, subject: string, html: string): Promise<void> {
    if (!this.resend) {
      this.logger.warn(`[Mail désactivé] to=${to} subject="${subject}"`);
      return;
    }
    try {
      const { error } = await this.resend.emails.send({ from: this.from, to, subject, html });
      if (error) {
        this.logger.error(`[Mail] Resend error to=${to}: ${error.message}`);
      } else {
        this.logger.log(`[Mail] Envoyé to=${to} subject="${subject}"`);
      }
    } catch (err: any) {
      this.logger.error(`[Mail] Exception to=${to}: ${err.message}`);
    }
  }

  sendAsync(to: string, subject: string, html: string): void {
    void this.sendRaw(to, subject, this.wrap(html));
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    await this.sendRaw(to, subject, this.wrap(html));
  }

  sendPasswordReset(to: string, resetUrl: string): void {
    const html = `
      <h2 style="color:#1E40AF;margin:0 0 16px;">Réinitialisation de mot de passe</h2>
      <p>Vous avez demandé une réinitialisation de votre mot de passe EduSen.</p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${resetUrl}" style="display:inline-block;padding:12px 28px;background:#1E40AF;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;">
          Réinitialiser mon mot de passe
        </a>
      </div>
      <p style="font-size:12px;color:#6b7280;">Ce lien est valable 30 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
    `;
    void this.sendRaw(to, 'Réinitialisation de votre mot de passe EduSen', this.wrap(html));
  }

  sendCompteCree(to: string, prenom: string, nom: string, tmpPwd: string, etablissement?: string): void {
    const intro = etablissement
      ? `Un compte administrateur a été créé pour vous sur la plateforme EduSen pour l'établissement <strong>${etablissement}</strong>.`
      : `Un compte a été créé pour vous sur la plateforme EduSen.`;
    const html = `
      <h2 style="color:#1E40AF;margin:0 0 16px;">Bienvenue sur EduSen</h2>
      <p>Bonjour <strong>${prenom} ${nom}</strong>,</p>
      <p>${intro}</p>
      <table style="border-collapse:collapse;margin:16px 0;width:100%;background:#f9fafb;padding:12px;">
        <tr>
          <td style="padding:8px 12px;color:#6b7280;font-size:13px;width:140px;">Email</td>
          <td style="padding:8px 12px;font-weight:600;font-size:13px;">${to}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;color:#6b7280;font-size:13px;">Mot de passe</td>
          <td style="padding:8px 12px;font-size:13px;"><code style="background:#e5e7eb;padding:4px 10px;font-size:14px;">${tmpPwd}</code></td>
        </tr>
      </table>
      <p style="color:#dc2626;font-weight:600;">Vous devrez changer ce mot de passe à votre première connexion.</p>
      <div style="text-align:center;margin:24px 0;">
        <a href="https://edusen.minifootapp.com" style="display:inline-block;padding:12px 28px;background:#1E40AF;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;">
          Se connecter
        </a>
      </div>
    `;
    void this.sendRaw(to, 'Votre compte EduSen a été créé', this.wrap(html));
  }

  sendBulletinDisponible(to: string, eleveNom: string, trimestre: string): void {
    const html = `
      <h2 style="color:#1E40AF;margin:0 0 16px;">Bulletin disponible</h2>
      <p>Le bulletin de <strong>${eleveNom}</strong> pour le <strong>${trimestre}</strong> est disponible.</p>
      <div style="text-align:center;margin:24px 0;">
        <a href="https://edusen.minifootapp.com" style="display:inline-block;padding:12px 28px;background:#1E40AF;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;">
          Consulter le bulletin
        </a>
      </div>
    `;
    void this.sendRaw(to, `Bulletin disponible — ${eleveNom}`, this.wrap(html));
  }

  sendConvocation(to: string, parentPrenom: string, eleveNom: string, date: string, motif: string): void {
    const html = `
      <h2 style="color:#1E40AF;margin:0 0 16px;">Convocation</h2>
      <p>Bonjour <strong>${parentPrenom}</strong>,</p>
      <p>Vous êtes convoqué(e) concernant l'élève <strong>${eleveNom}</strong>.</p>
      <table style="border-collapse:collapse;margin:16px 0;width:100%;background:#f9fafb;padding:12px;">
        <tr>
          <td style="padding:8px 12px;color:#6b7280;font-size:13px;width:140px;">Date</td>
          <td style="padding:8px 12px;font-weight:600;font-size:13px;">${date}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;color:#6b7280;font-size:13px;">Motif</td>
          <td style="padding:8px 12px;font-size:13px;">${motif}</td>
        </tr>
      </table>
    `;
    void this.sendRaw(to, `Convocation — ${eleveNom}`, this.wrap(html));
  }

  sendNotificationPaiement(to: string, eleveNom: string, montant: number, reference: string): void {
    const html = `
      <h2 style="color:#1E40AF;margin:0 0 16px;">Confirmation de paiement</h2>
      <p>Le paiement pour <strong>${eleveNom}</strong> a bien été enregistré.</p>
      <table style="border-collapse:collapse;margin:16px 0;width:100%;background:#f9fafb;padding:12px;">
        <tr>
          <td style="padding:8px 12px;color:#6b7280;font-size:13px;width:140px;">Montant</td>
          <td style="padding:8px 12px;font-weight:600;font-size:13px;">${montant.toLocaleString('fr-FR')} FCFA</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;color:#6b7280;font-size:13px;">Référence</td>
          <td style="padding:8px 12px;font-size:13px;">${reference}</td>
        </tr>
      </table>
    `;
    void this.sendRaw(to, `Confirmation de paiement — ${eleveNom}`, this.wrap(html));
  }
}
