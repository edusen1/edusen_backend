/**
 * Worker thread pour l'envoi d'emails via Resend.
 * S'exécute dans un thread séparé pour ne pas bloquer la boucle principale.
 */
import { parentPort } from 'worker_threads';
import { Resend } from 'resend';

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

if (!parentPort) {
  throw new Error('mail.worker must run as a worker thread');
}

parentPort.on('message', async (job: MailJob) => {
  const result: MailResult = { id: job.id, success: false };
  try {
    const resend = new Resend(job.apiKey);
    const { error } = await resend.emails.send({
      from: job.from,
      to: [job.to],
      subject: job.subject,
      html: job.html,
    });
    if (error) {
      result.error = error.message;
    } else {
      result.success = true;
    }
  } catch (err) {
    result.error = (err as Error).message;
  }
  parentPort!.postMessage(result);
});
