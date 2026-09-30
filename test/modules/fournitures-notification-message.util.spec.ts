import { buildFournituresWhatsappMessage } from '@/modules/fournitures-notification-message.util';

describe('buildFournituresWhatsappMessage', () => {
  it('includes the generated PDF link when available', () => {
    const message = buildFournituresWhatsappMessage({
      classeNom: 'Terminale S2 A',
      eleveNom: 'Mohamed Ndiaye',
      anneeLibelle: '2026-2027',
      destinataire: 'Parent',
      pdfUrl: 'https://edusen-api.minifootapp.com/api/storage/file?key=fournitures.pdf',
      obligatoires: [{ nom: 'Cahier', quantite: 4, obligatoire: true }],
      facultatifs: [],
    });

    expect(message).toContain('Mohamed Ndiaye');
    expect(message).toContain('Cahier');
    expect(message).toContain('https://edusen-api.minifootapp.com/api/storage/file?key=fournitures.pdf');
  });
});
