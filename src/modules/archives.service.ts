import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';

type ArchiveType = 'ANNEE_SCOLAIRE' | 'BULLETIN' | 'PAIEMENT';
type QueryValue = string | string[] | undefined;
type QueryParams = Record<string, QueryValue>;

@Injectable()
export class ArchivesService {
  constructor(private readonly prisma: PrismaService) {}

  private text(value: QueryValue): string | undefined {
    return Array.isArray(value) ? value[0] : value;
  }

  private pagination(query: QueryParams) {
    const page = Math.max(0, Number(this.text(query.page) ?? 0) || 0);
    const size = Math.min(100, Math.max(1, Number(this.text(query.size) ?? 20) || 20));
    return { page, size, skip: page * size };
  }

  private parseArchiveId(id: string): { type: ArchiveType; year: string; rawId?: string } {
    if (id.startsWith('bulletins-')) return { type: 'BULLETIN', year: id.slice('bulletins-'.length) };
    if (id.startsWith('paiements-')) return { type: 'PAIEMENT', year: id.slice('paiements-'.length) };
    if (id.startsWith('annee-')) return { type: 'ANNEE_SCOLAIRE', year: '', rawId: id.slice('annee-'.length) };
    throw new BadRequestException('Archive invalide');
  }

  private async findMatchingStudents(tenantId: string, search: string) {
    if (!search) return [];
    return this.prisma.user.findMany({
      where: {
        tenantId,
        role: 'ELEVE',
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { matricule: { contains: search, mode: 'insensitive' } },
        ],
      },
      select: { id: true, firstName: true, lastName: true, matricule: true },
      take: 200,
    });
  }

  private async usersByIds(tenantId: string, ids: string[]) {
    if (ids.length === 0) return new Map<string, { firstName: string; lastName: string; matricule: string | null }>();
    const users = await this.prisma.user.findMany({
      where: { tenantId, id: { in: [...new Set(ids)] } },
      select: { id: true, firstName: true, lastName: true, matricule: true },
    });
    return new Map(users.map((user) => [user.id, user]));
  }

  private studentName(user?: { firstName: string; lastName: string }) {
    return `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() || 'Élève non renseigné';
  }

  async getArchiveDetails(tenantId: string, id: string, query: QueryParams = {}) {
    const parsed = this.parseArchiveId(id);
    if (parsed.type === 'BULLETIN') return this.bulletinDetails(tenantId, id, parsed.year, query);
    if (parsed.type === 'PAIEMENT') return this.paiementDetails(tenantId, id, parsed.year, query);
    return this.anneeDetails(tenantId, id, parsed.rawId ?? '', query);
  }

  private async bulletinDetails(tenantId: string, id: string, year: string, query: QueryParams) {
    const { page, size, skip } = this.pagination(query);
    const search = (this.text(query.search) ?? '').trim();
    const matchingStudents = await this.findMatchingStudents(tenantId, search);
    const where = {
      tenantId,
      anneeScolaire: year,
      ...(search
        ? {
          OR: [
            ...(matchingStudents.length ? [{ eleveId: { in: matchingStudents.map((student) => student.id) } }] : []),
            { classe: { nom: { contains: search, mode: 'insensitive' as const } } },
            { trimestre: { contains: search, mode: 'insensitive' as const } },
          ],
        }
        : {}),
    };

    const [totalElements, bulletins] = await Promise.all([
      this.prisma.bulletin.count({ where }),
      this.prisma.bulletin.findMany({
        where,
        include: { classe: { select: { id: true, nom: true, serie: true } } },
        orderBy: [{ anneeScolaire: 'desc' }, { trimestre: 'asc' }, { updatedAt: 'desc' }],
        skip,
        take: size,
      }),
    ]);
    const students = await this.usersByIds(tenantId, bulletins.map((bulletin) => bulletin.eleveId));

    return {
      id,
      type: 'BULLETIN',
      anneeScolaire: year,
      page,
      size,
      totalElements,
      totalPages: Math.ceil(totalElements / size),
      content: (bulletins as Array<typeof bulletins[number] & { classe: { id: string; nom: string; serie: string | null } }>).map((bulletin) => {
        const student = students.get(bulletin.eleveId);
        return {
          id: bulletin.id,
          eleve: this.studentName(student),
          matricule: student?.matricule ?? null,
          classe: bulletin.classe.nom,
          serie: bulletin.classe.serie,
          trimestre: bulletin.trimestre,
          statut: bulletin.statut,
          moyenne: bulletin.moyenne,
          rang: bulletin.rang,
          totalEleves: bulletin.totalEleves,
          document: bulletin.fichierPdfUrl,
          dateReference: bulletin.updatedAt,
        };
      }),
    };
  }

  private async paiementDetails(tenantId: string, id: string, year: string, query: QueryParams) {
    const { page, size, skip } = this.pagination(query);
    const search = (this.text(query.search) ?? '').trim();
    const matchingStudents = await this.findMatchingStudents(tenantId, search);
    const where = {
      tenantId,
      anneeScolaire: year,
      ...(search
        ? {
          OR: [
            ...(matchingStudents.length ? [{ eleveId: { in: matchingStudents.map((student) => student.id) } }] : []),
            { reference: { contains: search, mode: 'insensitive' as const } },
            { description: { contains: search, mode: 'insensitive' as const } },
          ],
        }
        : {}),
    };

    const [totalElements, paiements] = await Promise.all([
      this.prisma.paiement.count({ where }),
      this.prisma.paiement.findMany({
        where,
        orderBy: [{ datePaiement: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: size,
      }),
    ]);
    const students = await this.usersByIds(tenantId, paiements.map((paiement) => paiement.eleveId));

    return {
      id,
      type: 'PAIEMENT',
      anneeScolaire: year,
      page,
      size,
      totalElements,
      totalPages: Math.ceil(totalElements / size),
      content: paiements.map((paiement) => {
        const student = students.get(paiement.eleveId);
        return {
          id: paiement.id,
          reference: paiement.reference,
          eleve: this.studentName(student),
          matricule: student?.matricule ?? null,
          montant: paiement.montant,
          typePaiement: paiement.typePaiement,
          modePaiement: paiement.modePaiement,
          statut: paiement.statut,
          trimestre: paiement.trimestre,
          description: paiement.description,
          dateReference: paiement.datePaiement ?? paiement.createdAt,
        };
      }),
    };
  }

  private async anneeDetails(tenantId: string, id: string, anneeId: string, query: QueryParams) {
    const { page, size, skip } = this.pagination(query);
    const search = (this.text(query.search) ?? '').trim();
    const annee = await this.prisma.anneeAcademique.findFirst({
      where: { id: anneeId, tenantId },
      select: { id: true, libelle: true },
    });
    if (!annee) throw new BadRequestException('Archive introuvable');

    const matchingStudents = await this.findMatchingStudents(tenantId, search);
    const where = {
      tenantId,
      anneeAcademiqueId: annee.id,
      ...(search
        ? {
          OR: [
            ...(matchingStudents.length ? [{ eleveId: { in: matchingStudents.map((student) => student.id) } }] : []),
            { classe: { nom: { contains: search, mode: 'insensitive' as const } } },
          ],
        }
        : {}),
    };

    const [totalElements, inscriptions] = await Promise.all([
      this.prisma.inscription.count({ where }),
      this.prisma.inscription.findMany({
        where,
        include: { classe: { select: { id: true, nom: true, serie: true } } },
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take: size,
      }),
    ]);
    const students = await this.usersByIds(tenantId, inscriptions.map((inscription) => inscription.eleveId));

    return {
      id,
      type: 'ANNEE_SCOLAIRE',
      anneeScolaire: annee.libelle,
      page,
      size,
      totalElements,
      totalPages: Math.ceil(totalElements / size),
      content: (inscriptions as Array<typeof inscriptions[number] & { classe: { id: string; nom: string; serie: string | null } }>).map((inscription) => {
        const student = students.get(inscription.eleveId);
        return {
          id: inscription.id,
          numeroInscription: inscription.numeroInscription,
          eleve: this.studentName(student),
          matricule: student?.matricule ?? null,
          classe: inscription.classe.nom,
          serie: inscription.classe.serie,
          statut: inscription.statut,
          fraisInscription: inscription.fraisInscription,
          dateReference: inscription.updatedAt,
        };
      }),
    };
  }
}
