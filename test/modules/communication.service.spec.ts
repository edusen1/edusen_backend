import { CommunicationService } from '@/modules/communication.service';

describe('CommunicationService', () => {
  function createService() {
    const prisma = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn().mockResolvedValue([]),
      communication: {
        create: jest.fn(),
      },
      notification: {
        createMany: jest.fn(),
      },
      notificationLog: {
        create: jest.fn(),
      },
    };
    const storage = {
      upload: jest.fn().mockResolvedValue('tenant/communications/file.png'),
      resolveUrl: jest.fn((value: string) => `https://api.test/storage/file?key=${encodeURIComponent(value)}`),
    };
    const push = {
      sendToUsers: jest.fn().mockResolvedValue(undefined),
    };
    return { service: new CommunicationService(prisma as never, storage as never, push as never), prisma, storage };
  }

  it('creates communications through Prisma with stored document metadata', async () => {
    const { service, prisma, storage } = createService();
    const createdAt = new Date('2026-09-30T16:41:00Z');
    prisma.communication.create.mockResolvedValue({
      id: 'communication-id',
      tenantId: '12f63cf0-6503-4e71-a133-4ee746662522',
      titre: 'Notification 1',
      contenu: 'Notif 1 Test',
      canal: 'IN_APP',
      statut: 'ENVOYE',
      cibleType: 'ROLES',
      cible: 'TOUS',
      roles: ['ADMIN', 'ELEVE'],
      classeIds: [],
      niveauIds: [],
      cycleIds: [],
      utilisateurIds: [],
      inclureParents: false,
      inclureEleves: true,
      nbDestinataires: 0,
      nbLus: 0,
      documentUrl: 'https://api.test/storage/file?key=tenant%2Fcommunications%2Ffile.png',
      documentNom: 'image.png',
      documentMimeType: 'image/png',
      documentTaille: 4,
      documents: [{
        url: 'https://api.test/storage/file?key=tenant%2Fcommunications%2Ffile.png',
        nom: 'image.png',
        mimeType: 'image/png',
        taille: 4,
      }],
      anneeAcademiqueId: 'bd0db7db-715d-48c5-b7db-a40de9e0e3b7',
      datePlanifiee: null,
      envoyeLe: createdAt,
      auteurId: '3a04b973-376f-4a7c-ac07-3a000f210399',
      createdAt,
      updatedAt: createdAt,
    });

    await service.create(
      '12f63cf0-65d3-4e71-a133-4ee746662522',
      {
        titre: 'Notification 1',
        contenu: 'Notif 1 Test',
        canal: 'NOTIFICATION',
        cible: 'TOUS',
        roles: [],
        envoiImmediat: true,
        brouillon: false,
        anneeAcademiqueId: 'bd0db7db-715d-48c5-b7db-a40de9e0e3b7',
        documents: [{ base64: Buffer.from('test').toString('base64'), mimeType: 'image/png', nom: 'image.png' }],
      },
      '3a04b973-376f-4a7c-ac07-3a000f210399',
    );

    expect(storage.upload).toHaveBeenCalledWith(
      expect.stringContaining('/communications/'),
      Buffer.from('test'),
      'image/png',
    );
    expect(prisma.communication.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        titre: 'Notification 1',
        contenu: 'Notif 1 Test',
        canal: 'IN_APP',
        statut: 'ENVOYE',
        cible: 'TOUS',
        documentNom: 'image.png',
        documentMimeType: 'image/png',
        documentTaille: 4,
        anneeAcademiqueId: 'bd0db7db-715d-48c5-b7db-a40de9e0e3b7',
        auteurId: '3a04b973-376f-4a7c-ac07-3a000f210399',
      }),
    });
  });
});
