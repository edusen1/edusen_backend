import { buildPaymentReceiptWhatsappMessage } from '@/modules/payment-whatsapp-message.util';

describe('buildPaymentReceiptWhatsappMessage', () => {
  it('builds a text receipt message with the uploaded PDF link', () => {
    const message = buildPaymentReceiptWhatsappMessage({
      amount: 15000,
      reference: 'PAY-2026-ABC123',
      receiptUrl: 'https://edusen-api.minifootapp.com/api/storage/file?key=recu.pdf',
    });

    expect(message).toContain('15\u202f000 MRU');
    expect(message).toContain('PAY-2026-ABC123');
    expect(message).toContain('https://edusen-api.minifootapp.com/api/storage/file?key=recu.pdf');
    expect(message).toContain('reçu PDF');
  });
});
