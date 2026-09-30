import { formatMru } from '@/common/utils/currency.util';

export function buildPaymentReceiptWhatsappMessage(input: {
  amount: number | string | null | undefined;
  reference: string;
  receiptUrl: string;
}): string {
  return [
    `Votre paiement de ${formatMru(input.amount)} a été validé.`,
    `Référence : ${input.reference}`,
    '',
    'Votre reçu PDF est disponible ici :',
    input.receiptUrl,
  ].join('\n');
}
