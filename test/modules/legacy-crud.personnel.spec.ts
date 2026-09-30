import { ConflictException } from '@nestjs/common';
import { LegacyCrudService } from '@/modules/legacy-crud.service';

describe('LegacyCrudService personnel', () => {
  const tenantId = '12f63cf0-65d3-4e71-a133-4ee746662522';
  const sectionId = '98306460-02ae-4bec-9839-792d3e435a1c';

  function createService() {
    const prisma = {
      ecoleConfig: {
        findUnique: jest.fn().mockResolvedValue({ pays: 'SN' }),
      },
      cycle: {
        findFirst: jest.fn().mockResolvedValue({ id: sectionId, tenantId }),
      },
      user: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      personnel: {
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({
          id: '066822a1-4feb-4e58-9cce-14d87a6c9531',
          tenantId,
          utilisateurId: '8b37f54a-e165-4f25-9484-a621fc814c70',
        }),
      },
      surveillantCycle: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    const storage = {
      resolveUrl: jest.fn((value: string) => value),
    };
    const service = new LegacyCrudService(
      prisma as never,
      storage as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, prisma };
  }

  it('refuses to attach a personnel record to an existing student account', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue({
      id: '8b37f54a-e165-4f25-9484-a621fc814c70',
      email: 'mamadou@gmail.com',
      telephone: '+221777151068',
      role: 'ELEVE',
      roles: [],
    });

    await expect(service.create(service.adminConfig('personnel'), tenantId, {
      prenom: 'Mamadou',
      nom: 'DIALLO',
      email: 'mamadou@gmail.com',
      telephone: '777151068',
      adresse: 'DAKAR',
      type: 'SURVEILLANT',
      affectationType: 'SURVEILLANT',
      sectionId,
      typeContrat: 'CDI',
    })).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.personnel.create).not.toHaveBeenCalled();
  });
});
