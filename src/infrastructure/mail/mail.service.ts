import { Injectable, Logger } from "@nestjs/common";
import { Worker } from "worker_threads";
import { randomUUID } from "node:crypto";
import * as path from "node:path";

interface MailJob {
  id: string;
  to: string;
  subject: string;
  html: string;
  from: string;
  apiKey: string;
}

interface MailResult {
  id: string;
  success: boolean;
  error?: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly apiKey: string | null;
  private readonly from: string;
  private readonly workerPath: string;

  constructor() {
    this.apiKey = process.env.RESEND_API_KEY ?? null;
    this.from =
      process.env.RESEND_FROM_EMAIL ?? "NouraSchool <onboarding@resend.dev>";
    // Worker path - adapté selon le build (dist) ou source directe
    this.workerPath = path.resolve(__dirname, "mail.worker.js");
  }

  /** Envoie un email de manière asynchrone via worker thread (fire-and-forget). */
  sendAsync(to: string, subject: string, html: string): void {
    if (!this.apiKey) {
      this.logger.warn(
        `[Mail] RESEND_API_KEY manquante - email non envoyé à ${this.maskEmail(to)}`,
      );
      return;
    }

    const job: MailJob = {
      id: randomUUID(),
      to,
      subject,
      html,
      from: this.from,
      apiKey: this.apiKey,
    };

    let worker: Worker;
    try {
      worker = new Worker(this.workerPath);
    } catch (err) {
      this.logger.error(
        `[Mail] Worker bootstrap failed: ${(err as Error).message}`,
      );
      return;
    }

    worker.once("message", (result: MailResult) => {
      if (result.success) {
        this.logger.log(
          `[Mail] Envoyé to=${this.maskEmail(to)} subject="${subject}"`,
        );
      } else {
        this.logger.error(
          `[Mail] Échec to=${this.maskEmail(to)} subject="${subject}" error=${result.error}`,
        );
      }
      void worker.terminate();
    });

    worker.once("error", (err) => {
      this.logger.error(
        `[Mail] Worker error to=${this.maskEmail(to)}: ${err.message}`,
      );
      void worker.terminate();
    });

    worker.postMessage(job);
  }

  /** Envoie et attend la confirmation (await). */
  async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.apiKey) {
      this.logger.warn(
        `[Mail] RESEND_API_KEY manquante - email non envoyé à ${this.maskEmail(to)}`,
      );
      return;
    }

    const job: MailJob = {
      id: randomUUID(),
      to,
      subject,
      html,
      from: this.from,
      apiKey: this.apiKey,
    };

    return new Promise((resolve, reject) => {
      let worker: Worker;
      try {
        worker = new Worker(this.workerPath);
      } catch (err) {
        reject(err);
        return;
      }

      worker.once("message", (result: MailResult) => {
        void worker.terminate();
        if (result.success) {
          resolve();
        } else {
          reject(new Error(result.error ?? "Email sending failed"));
        }
      });

      worker.once("error", (err) => {
        void worker.terminate();
        reject(err);
      });

      worker.postMessage(job);
    });
  }

  sendPasswordReset(to: string, resetUrl: string): void {
    this.sendAsync(
      to,
      "Réinitialisation de votre mot de passe - Noura School",
      this.tplPasswordReset(resetUrl),
    );
  }

  sendCompteCree(
    to: string,
    prenom: string,
    nom: string,
    motDePasseTemporaire: string,
  ): void {
    this.sendAsync(
      to,
      "Votre compte Noura School a été créé",
      this.tplCompteCree(prenom, nom, to, motDePasseTemporaire),
    );
  }

  sendBulletinDisponible(
    to: string,
    eleveNom: string,
    trimestre: string,
    lienAcces?: string,
  ): void {
    this.sendAsync(
      to,
      `Bulletin scolaire disponible - ${trimestre}`,
      this.tplBulletinDisponible(eleveNom, trimestre, lienAcces),
    );
  }

  sendConvocation(
    to: string,
    parentPrenom: string,
    eleveNom: string,
    date: string,
    motif: string,
  ): void {
    this.sendAsync(
      to,
      "Convocation - Noura School",
      this.tplConvocation(parentPrenom, eleveNom, date, motif),
    );
  }

  sendNotificationPaiement(
    to: string,
    eleveNom: string,
    montant: number,
    reference: string,
  ): void {
    this.sendAsync(
      to,
      "Confirmation de paiement - Noura School",
      this.tplPaiement(eleveNom, montant, reference),
    );
  }

  // ==================== TEMPLATES ====================

  private tplPasswordReset(resetUrl: string): string {
    return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px">
<h2 style="color:#2563eb">Réinitialisation de mot de passe</h2>
<p>Bonjour,</p>
<p>Vous avez demandé une réinitialisation de votre mot de passe Noura School.</p>
<p><a href="${resetUrl}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;margin:16px 0">Réinitialiser mon mot de passe</a></p>
<p style="color:#666;font-size:13px">Ce lien expire dans 60 minutes. Si vous n'avez pas fait cette demande, ignorez cet email.</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
<p style="color:#9ca3af;font-size:12px">© Noura School - Ne pas répondre à cet email</p>
</body></html>`;
  }

  private tplCompteCree(
    prenom: string,
    nom: string,
    email: string,
    tmpPwd: string,
  ): string {
    return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px">
<h2 style="color:#2563eb">Bienvenue sur Noura School</h2>
<p>Bonjour ${prenom} ${nom},</p>
<p>Votre compte a été créé avec succès. Voici vos identifiants :</p>
<table style="background:#f3f4f6;padding:16px;border-radius:8px;width:100%">
<tr><td><strong>Email :</strong></td><td>${email}</td></tr>
<tr><td><strong>Mot de passe temporaire :</strong></td><td style="font-family:monospace;font-size:16px;font-weight:bold;color:#dc2626">${tmpPwd}</td></tr>
</table>
<p style="margin-top:16px"><strong>Veuillez modifier ce mot de passe dès votre première connexion.</strong></p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
<p style="color:#9ca3af;font-size:12px">© Noura School - Ne pas répondre à cet email</p>
</body></html>`;
  }

  private tplBulletinDisponible(
    eleveNom: string,
    trimestre: string,
    lien?: string,
  ): string {
    return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px">
<h2 style="color:#2563eb">Bulletin disponible</h2>
<p>Bonjour,</p>
<p>Le bulletin scolaire de <strong>${eleveNom}</strong> pour le <strong>${trimestre}</strong> est maintenant disponible.</p>
${lien ? `<p><a href="${lien}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;margin:16px 0">Consulter le bulletin</a></p>` : "<p>Connectez-vous à votre espace Noura School pour le consulter.</p>"}
<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
<p style="color:#9ca3af;font-size:12px">© Noura School</p>
</body></html>`;
  }

  private tplConvocation(
    parentPrenom: string,
    eleveNom: string,
    date: string,
    motif: string,
  ): string {
    return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px">
<h2 style="color:#dc2626">Convocation</h2>
<p>Bonjour ${parentPrenom},</p>
<p>Vous êtes convoqué(e) à l'école concernant <strong>${eleveNom}</strong>.</p>
<table style="background:#f3f4f6;padding:16px;border-radius:8px;width:100%">
<tr><td><strong>Date :</strong></td><td>${date}</td></tr>
<tr><td><strong>Motif :</strong></td><td>${motif}</td></tr>
</table>
<p style="margin-top:16px">Merci de vous présenter à l'heure indiquée.</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
<p style="color:#9ca3af;font-size:12px">© Noura School</p>
</body></html>`;
  }

  private tplPaiement(
    eleveNom: string,
    montant: number,
    reference: string,
  ): string {
    return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px">
<h2 style="color:#059669">Confirmation de paiement</h2>
<p>Bonjour,</p>
<p>Votre paiement pour <strong>${eleveNom}</strong> a été confirmé.</p>
<table style="background:#f3f4f6;padding:16px;border-radius:8px;width:100%">
<tr><td><strong>Montant :</strong></td><td>${montant.toLocaleString("fr-FR")} FCFA</td></tr>
<tr><td><strong>Référence :</strong></td><td>${reference}</td></tr>
</table>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
<p style="color:#9ca3af;font-size:12px">© Noura School</p>
</body></html>`;
  }

  private maskEmail(email: string): string {
    const at = email.indexOf("@");
    if (at <= 1) return "***";
    return `${email[0]}***${email.substring(at)}`;
  }
}
