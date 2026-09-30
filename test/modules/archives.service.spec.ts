import { ArchivesService } from '@/modules/archives.service';

describe('ArchivesService', () => {
  function createService() {
    const prisma = {
      bulletin: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
      paiement: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
      inscription: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
      user: {
        findMany: jest.fn(),
      },
    };
    return { service: new ArchivesService(prisma as never), prisma };
  }

  it('returns paged bulletin archive details with student and class context', async () => {
    const { service, prisma } = createService();
    prisma.user.findMany.mockResolvedValue([
      { id: 'e1', firstName: 'Awa', lastName: 'DIOP', matricule: 'ELV-001' },
    ]);
    prisma.bulletin.count.mockResolvedValue(1);
    prisma.bulletin.findMany.mockResolvedValue([
      {
        id: 'b1',
        eleveId: 'e1',
        anneeScolaire: '2025-2026',
        trimestre: 'T1',
        statut: 'PUBLIE',
        moyenne: 14.25,
        rang: 3,
        totalEleves: 42,
        fichierPdfUrl: 'tenant/bulletins/b1.pdf',
        updatedAt: new Date('2026-01-15T10:00:00Z'),
        classe: { id: 'c1', nom: 'Terminale S2 A', serie: 'S2' },
      },
    ]);

    const result = await service.getArchiveDetails('tenant-1', 'bulletins-2025-2026', {
      page: '0',
      size: '10',
      search: 'awa',
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        role: 'ELEVE',
        OR: [
          { firstName: { contains: 'awa', mode: 'insensitive' } },
          { lastName: { contains: 'awa', mode: 'insensitive' } },
          { matricule: { contains: 'awa', mode: 'insensitive' } },
        ],
      },
      select: { id: true, firstName: true, lastName: true, matricule: true },
      take: 200,
    });
    const expectedWhere = {
        tenantId: 'tenant-1',
        anneeScolaire: '2025-2026',
        OR: [
          { eleveId: { in: ['e1'] } },
          { classe: { nom: { contains: 'awa', mode: 'insensitive' } } },
          { trimestre: { contains: 'awa', mode: 'insensitive' } },
        ],
    };
    expect(prisma.bulletin.count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(prisma.bulletin.findMany).toHaveBeenCalledWith({
      where: expectedWhere,
      include: { classe: { select: { id: true, nom: true, serie: true } } },
      orderBy: [{ anneeScolaire: 'desc' }, { trimestre: 'asc' }, { updatedAt: 'desc' }],
      skip: 0,
      take: 10,
    });
    expect(result).toEqual({
      id: 'bulletins-2025-2026',
      type: 'BULLETIN',
      anneeScolaire: '2025-2026',
      page: 0,
      size: 10,
      totalElements: 1,
      totalPages: 1,
      content: [
        {
          id: 'b1',
          eleve: 'Awa DIOP',
          matricule: 'ELV-001',
          classe: 'Terminale S2 A',
          serie: 'S2',
          trimestre: 'T1',
          statut: 'PUBLIE',
          moyenne: 14.25,
          rang: 3,
          totalEleves: 42,
          document: 'tenant/bulletins/b1.pdf',
          dateReference: new Date('2026-01-15T10:00:00Z'),
        },
      ],
    });
  });
});
