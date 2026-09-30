import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

export interface SchoolBranding {
  name: string;
  initials: string;
  logoUrl?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

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

  /** Template générique EduSen (plateforme) */
  private wrapEdusen(body: string): string {
    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>EduSen</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet"/>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Inter','Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.07);">
        <tr>
          <td style="width:7px;background:#2563eb;padding:0;" width="7">&nbsp;</td>
          <td style="background:#0f172a;padding:28px 32px;">
            <div style="font-size:22px;font-weight:900;color:#ffffff;letter-spacing:-.02em;">EDUSEN</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:4px;letter-spacing:.04em;">Gestion scolaire intelligente</div>
          </td>
        </tr>
        <tr>
          <td style="width:7px;background:#2563eb;" width="7">&nbsp;</td>
          <td style="padding:32px;">
            ${body}
          </td>
        </tr>
        <tr>
          <td style="width:7px;background:#2563eb;" width="7">&nbsp;</td>
          <td style="padding:20px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;">
            <div style="font-size:11px;color:#94a3b8;line-height:1.6;">
              EduSen &mdash; Plateforme de gestion scolaire<br/>
              <a href="https://edusen.minifootapp.com" style="color:#2563eb;text-decoration:none;">edusen.minifootapp.com</a>
            </div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  /** Template école — logo/nom de l'établissement dans l'en-tête */
  private wrapSchool(body: string, school: SchoolBranding): string {
    const contactParts = [school.address, school.phone, school.email].filter(Boolean);
    const contact = contactParts.join(' · ');
    const logoHtml = school.logoUrl
      ? `<img src="${this.esc(school.logoUrl)}" alt="logo" style="width:48px;height:48px;object-fit:contain;flex:none;">`
      : `<span style="width:48px;height:48px;background:#2563eb;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:18px;flex:none;">${this.esc(school.initials)}</span>`;

    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${this.esc(school.name)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet"/>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Inter','Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.07);">
        <!-- accent + header -->
        <tr>
          <td style="width:7px;background:#2563eb;padding:0;" width="7">&nbsp;</td>
          <td style="background:#0f172a;padding:24px 32px;">
            <div style="display:inline-flex;align-items:center;gap:14px;">
              ${logoHtml}
              <div>
                <div style="font-size:18px;font-weight:800;color:#ffffff;letter-spacing:-.02em;line-height:1.2;">${this.esc(school.name)}</div>
                ${contact ? `<div style="font-size:11px;color:rgba(255,255,255,0.45);margin-top:4px;line-height:1.5;">${this.esc(contact)}</div>` : ''}
              </div>
            </div>
          </td>
        </tr>
        <!-- body -->
        <tr>
          <td style="width:7px;background:#2563eb;" width="7">&nbsp;</td>
          <td style="padding:32px;">
            ${body}
          </td>
        </tr>
        <!-- footer -->
        <tr>
          <td style="width:7px;background:#2563eb;" width="7">&nbsp;</td>
          <td style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;">
            <div style="font-size:11px;color:#94a3b8;line-height:1.6;">
              ${this.esc(school.name)} &mdash; via <a href="https://edusen.minifootapp.com" style="color:#2563eb;text-decoration:none;">EduSen</a>
            </div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  private async sendRaw(to: string, subject: string, html: string, from?: string): Promise<void> {
    if (!this.resend) {
      this.logger.warn(`[Mail désactivé] to=${to} subject="${subject}"`);
      return;
    }
    try {
      const { error } = await this.resend.emails.send({ from: from ?? this.from, to, subject, html });
      if (error) {
        this.logger.error(`[Mail] Resend error to=${to}: ${error.message}`);
      } else {
        this.logger.log(`[Mail] Envoyé to=${to} subject="${subject}"`);
      }
    } catch (err: unknown) {
      this.logger.error(`[Mail] Exception to=${to}: ${(err as Error).message}`);
    }
  }

  sendAsync(to: string, subject: string, html: string): void {
    void this.sendRaw(to, subject, this.wrapEdusen(html));
  }

  sendAsyncFromSchool(to: string, subject: string, html: string, school: SchoolBranding, from?: string): void {
    void this.sendRaw(to, subject, this.wrapSchool(html, school), from);
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    await this.sendRaw(to, subject, this.wrapEdusen(html));
  }

  sendPasswordReset(to: string, resetUrl: string): void {
    const html = `
      <h2 style="color:#0f172a;font-size:18px;font-weight:800;margin:0 0 16px;">Réinitialisation de mot de passe</h2>
      <p style="color:#475569;line-height:1.6;">Vous avez demandé une réinitialisation de votre mot de passe EduSen.</p>
      <div style="text-align:center;margin:28px 0;">
        <a href="${this.esc(resetUrl)}" style="display:inline-block;padding:12px 28px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:.02em;">
          Réinitialiser mon mot de passe
        </a>
      </div>
      <p style="font-size:12px;color:#94a3b8;">Ce lien est valable 30 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
    `;
    void this.sendRaw(to, 'Réinitialisation de votre mot de passe EduSen', this.wrapEdusen(html));
  }

  sendCompteCree(to: string, prenom: string, nom: string, tmpPwd: string, school?: SchoolBranding | string): void {
    const schoolBranding = school && typeof school === 'object' ? school : null;
    const schoolName = schoolBranding?.name ?? (typeof school === 'string' ? school : null);
    const intro = schoolName
      ? `Un compte a été créé pour vous à <strong>${this.esc(schoolName)}</strong>.`
      : `Un compte a été créé pour vous sur la plateforme EduSen.`;

    const html = `
      <h2 style="color:#0f172a;font-size:18px;font-weight:800;margin:0 0 16px;">Bienvenue</h2>
      <p style="color:#475569;line-height:1.6;">Bonjour <strong>${this.esc(prenom)} ${this.esc(nom)}</strong>,</p>
      <p style="color:#475569;line-height:1.6;">${intro}</p>
      <table style="border-collapse:collapse;margin:20px 0;width:100%;background:#f8fafc;border:1px solid #e2e8f0;">
        <tr>
          <td style="padding:10px 14px;color:#64748b;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;width:130px;border-bottom:1px solid #e2e8f0;">Identifiant</td>
          <td style="padding:10px 14px;font-weight:600;font-size:14px;border-bottom:1px solid #e2e8f0;font-family:'JetBrains Mono',monospace;">${this.esc(to)}</td>
        </tr>
        <tr>
          <td style="padding:10px 14px;color:#64748b;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;">Mot de passe</td>
          <td style="padding:10px 14px;font-size:14px;font-family:'JetBrains Mono',monospace;"><span style="background:#fef3c7;padding:4px 10px;font-weight:700;letter-spacing:.04em;">${this.esc(tmpPwd)}</span></td>
        </tr>
      </table>
      <p style="color:#dc2626;font-weight:600;font-size:13px;">Vous devrez changer ce mot de passe à votre première connexion.</p>
      <div style="text-align:center;margin:24px 0;">
        <a href="https://edusen.minifootapp.com" style="display:inline-block;padding:12px 28px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;">
          Se connecter
        </a>
      </div>
    `;

    const wrapped = schoolBranding ? this.wrapSchool(html, schoolBranding) : this.wrapEdusen(html);
    void this.sendRaw(to, schoolName ? `Vos accès — ${schoolName}` : 'Votre compte EduSen a été créé', wrapped);
  }

  sendBulletinDisponible(to: string, eleveNom: string, trimestre: string, school?: SchoolBranding): void {
    const html = `
      <h2 style="color:#0f172a;font-size:18px;font-weight:800;margin:0 0 16px;">Bulletin disponible</h2>
      <p style="color:#475569;line-height:1.6;">Le bulletin de <strong>${this.esc(eleveNom)}</strong> pour le <strong>${this.esc(trimestre)}</strong> est disponible.</p>
      <div style="text-align:center;margin:28px 0;">
        <a href="https://edusen.minifootapp.com" style="display:inline-block;padding:12px 28px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;">
          Consulter le bulletin
        </a>
      </div>
    `;
    const wrapped = school ? this.wrapSchool(html, school) : this.wrapEdusen(html);
    void this.sendRaw(to, `Bulletin disponible — ${eleveNom}`, wrapped);
  }

  sendConvocation(to: string, parentPrenom: string, eleveNom: string, date: string, motif: string, school?: SchoolBranding): void {
    const html = `
      <h2 style="color:#0f172a;font-size:18px;font-weight:800;margin:0 0 16px;">Convocation</h2>
      <p style="color:#475569;line-height:1.6;">Bonjour <strong>${this.esc(parentPrenom)}</strong>,</p>
      <p style="color:#475569;line-height:1.6;">Vous êtes convoqué(e) concernant l'élève <strong>${this.esc(eleveNom)}</strong>.</p>
      <table style="border-collapse:collapse;margin:20px 0;width:100%;background:#f8fafc;border:1px solid #e2e8f0;">
        <tr>
          <td style="padding:10px 14px;color:#64748b;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;width:130px;border-bottom:1px solid #e2e8f0;">Date</td>
          <td style="padding:10px 14px;font-weight:600;font-size:14px;border-bottom:1px solid #e2e8f0;">${this.esc(date)}</td>
        </tr>
        <tr>
          <td style="padding:10px 14px;color:#64748b;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;">Motif</td>
          <td style="padding:10px 14px;font-size:14px;">${this.esc(motif)}</td>
        </tr>
      </table>
    `;
    const wrapped = school ? this.wrapSchool(html, school) : this.wrapEdusen(html);
    void this.sendRaw(to, `Convocation — ${eleveNom}`, wrapped);
  }

  sendNotificationPaiement(to: string, eleveNom: string, montant: number, reference: string, school?: SchoolBranding): void {
    const montantStr = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(montant);
    const html = `
      <h2 style="color:#0f172a;font-size:18px;font-weight:800;margin:0 0 16px;">Confirmation de paiement</h2>
      <p style="color:#475569;line-height:1.6;">Le paiement pour <strong>${this.esc(eleveNom)}</strong> a bien été enregistré.</p>
      <table style="border-collapse:collapse;margin:20px 0;width:100%;background:#f8fafc;border:1px solid #e2e8f0;">
        <tr>
          <td style="padding:10px 14px;color:#64748b;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;width:130px;border-bottom:1px solid #e2e8f0;">Montant</td>
          <td style="padding:10px 14px;font-weight:700;font-size:15px;font-family:'JetBrains Mono',monospace;border-bottom:1px solid #e2e8f0;">${montantStr} FCFA</td>
        </tr>
        <tr>
          <td style="padding:10px 14px;color:#64748b;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;">Référence</td>
          <td style="padding:10px 14px;font-size:14px;font-family:'JetBrains Mono',monospace;">${this.esc(reference)}</td>
        </tr>
      </table>
      <div style="display:inline-flex;align-items:center;gap:8px;background:#dcfce7;padding:10px 16px;margin-top:4px;">
        <span style="font-size:13px;font-weight:700;color:#15803d;letter-spacing:.04em;">&#10003; PAYÉ</span>
      </div>
    `;
    const wrapped = school ? this.wrapSchool(html, school) : this.wrapEdusen(html);
    void this.sendRaw(to, `Confirmation de paiement — ${eleveNom}`, wrapped);
  }

  private esc(value: string): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
