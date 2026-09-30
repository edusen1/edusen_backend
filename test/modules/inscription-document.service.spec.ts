import { InscriptionDocumentService } from '@/modules/inscription-document.service';

describe('InscriptionDocumentService', () => {
  it('returns the public URL produced by storage when generating the PDF', async () => {
    const prisma = {
      inscription: {
        findFirst: jest.fn().mockResolvedValue({
          numeroInscription: 'INS-2026-001',
          createdAt: new Date('2026-09-30T10:00:00Z'),
          classe: { nom: 'Terminale S2 A' },
          anneeAcademique: { libelle: '2026-2027' },
        }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          firstName: 'Awa',
          lastName: 'Ndiaye',
          matricule: 'MAT-001',
        }),
      },
      ecoleConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          nom: 'EduSen',
          adresse: 'Dakar',
          telephone: '+221000000000',
          logoUrl: null,
        }),
      },
    };
    const storage = {
      resolveUrl: jest.fn().mockReturnValue(null),
      upload: jest.fn().mockResolvedValue('https://edusen-api.minifootapp.com/api/storage/file?key=fiche.pdf'),
    };
    const service = new InscriptionDocumentService(prisma as any, storage as any);
    jest.spyOn(service as any, 'renderPdf').mockResolvedValue(Buffer.from('pdf'));

    const result = await service.generate('tenant-1', 'eleve-1', 'classe-1', []);

    expect(result?.url).toBe('https://edusen-api.minifootapp.com/api/storage/file?key=fiche.pdf');
  });
});
