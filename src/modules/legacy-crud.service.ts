import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '@/config/prisma.service';
import { StorageService } from '@/infrastructure/storage/storage.service';
import { MailService } from '@/infrastructure/mail/mail.service';
import { WhatsappService } from '@/modules/whatsapp/whatsapp.service';

type QueryValue = string | string[] | undefined;
type QueryParams = Record<string, QueryValue>;
type Payload = Record<string, unknown>;

interface CrudConfig {
  model: string;
  tenantScoped?: boolean;
  role?: string;
  paged?: boolean;
  dateFields?: string[];
  defaultOrderBy?: Record<string, 'asc' | 'desc'>;
}

const V1_RESOURCES: Record<string, CrudConfig> = {
  utilisateurs: { model: 'user', tenantScoped: true, paged: true },
  eleves: { model: 'user', tenantScoped: true, role: 'ELEVE', paged: true },
  enseignants: { model: 'user', tenantScoped: true, role: 'ENSEIGNANT', paged: true },
  parents: { model: 'user', tenantScoped: true, role: 'PARENT', paged: true },
  cycles: { model: 'cycle', tenantScoped: true, defaultOrderBy: { code: 'asc' } },
  niveaux: { model: 'niveau', tenantScoped: true, defaultOrderBy: { ordre: 'asc' } },
  'annees-academiques': {
    model: 'anneeAcademique',
    tenantScoped: true,
    dateFields: ['dateDebut', 'dateFin'],
    defaultOrderBy: { dateDebut: 'desc' },
  },
  batiments: { model: 'batiment', tenantScoped: true, defaultOrderBy: { nom: 'asc' } },
  salles: { model: 'salle', tenantScoped: true, defaultOrderBy: { nom: 'asc' } },
  classes: { model: 'classe', tenantScoped: true, paged: true, defaultOrderBy: { nom: 'asc' } },
  cours: { model: 'cours', tenantScoped: true },
  inscriptions: { model: 'inscription', tenantScoped: true, paged: true },
  paiements: { model: 'paiement', tenantScoped: true, paged: true, dateFields: ['datePaiement'] },
  'absences-eleves': { model: 'absenceEleve', tenantScoped: true, paged: true, dateFields: ['date'] },
  'emplois-du-temps': {
    model: 'emploiDuTemps',
    tenantScoped: true,
    dateFields: ['dateDebutValidite', 'dateFinValidite'],
  },
  appels: { model: 'appel', tenantScoped: true, paged: true, dateFields: ['dateCours'] },
  'cahier-texte': { model: 'cahierTexte', tenantScoped: true, paged: true, dateFields: ['dateCours'] },
  convocations: { model: 'convocation', tenantScoped: true, paged: true, dateFields: ['dateConvocation'] },
  notifications: { model: 'notification', tenantScoped: true, paged: true },
  annonces: { model: 'annonce', tenantScoped: true, paged: true, dateFields: ['dateDebut', 'dateFin'] },
  personnel: { model: 'personnel', tenantScoped: true, paged: true, dateFields: ['dateEmbauche'] },
  pointages: { model: 'pointage', tenantScoped: true, dateFields: ['dateHeure'] },
  'absences-personnel': {
    model: 'absencePersonnel',
    tenantScoped: true,
    paged: true,
    dateFields: ['dateDebut', 'dateFin'],
  },
  notes: { model: 'note', tenantScoped: true, paged: true, dateFields: ['dateEvaluation'] },
  bulletins: { model: 'bulletin', tenantScoped: true, paged: true },
  reclamations: { model: 'reclamation', tenantScoped: true, paged: true },
  matieres: { model: 'matiere', tenantScoped: true, paged: true, defaultOrderBy: { libelle: 'asc' } },
  'matieres-classes': { model: 'matiereClasse', tenantScoped: true, paged: true },
  'calendrier-scolaire': {
    model: 'calendrierScolaire',
    tenantScoped: true,
    dateFields: ['dateDebut', 'dateFin'],
  },
};

const ADMIN_RESOURCES: Record<string, CrudConfig> = {
  users: V1_RESOURCES.utilisateurs,
  eleves: V1_RESOURCES.eleves,
  enseignants: V1_RESOURCES.enseignants,
  parents: V1_RESOURCES.parents,
  classes: V1_RESOURCES.classes,
  matieres: V1_RESOURCES.matieres,
  'matieres-classes': V1_RESOURCES['matieres-classes'],
  notes: V1_RESOURCES.notes,
  bulletins: V1_RESOURCES.bulletins,
  paiements: V1_RESOURCES.paiements,
  'absences-eleves': V1_RESOURCES['absences-eleves'],
  reclamations: V1_RESOURCES.reclamations,
  'emplois-du-temps': V1_RESOURCES['emplois-du-temps'],
  'calendrier-scolaire': V1_RESOURCES['calendrier-scolaire'],
  appels: V1_RESOURCES.appels,
  'cahier-texte': V1_RESOURCES['cahier-texte'],
};

@Injectable()
export class LegacyCrudService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly mailService: MailService,
    private readonly whatsappService: WhatsappService,
  ) {}

  v1Config(resource: string): CrudConfig {
    return this.getConfig(V1_RESOURCES, resource);
  }

  adminConfig(resource: string): CrudConfig {
    return this.getConfig(ADMIN_RESOURCES, resource);
  }

  async findAll(config: CrudConfig, tenantId: string | undefined, query: QueryParams = {}) {
    const delegate = this.delegate(config.model);
    const where = this.buildWhere(config, tenantId, query);
    const orderBy = this.orderBy(config, query);

    if (config.model === 'classe' && !where.anneeAcademiqueId) {
      const currentYear = await this.findCurrentAnnee(tenantId);
      if (currentYear) {
        where.anneeAcademiqueId = currentYear.id;
      }
    }

    const include = config.model === 'classe' ? {
      niveau: { include: { cycle: true } },
      anneeAcademique: true,
      professeurResponsable: true,
      salle: true,
      stagiaires: { include: { stagiaire: true } },
      _count: { select: { eleves: true } }
    } : config.model === 'matiereClasse' ? {
      matiere: true,
      enseignant: true
    } : config.model === 'personnel' ? {
      utilisateur: {
        select: {
          id: true,
          username: true,
          email: true,
          firstName: true,
          lastName: true,
          telephone: true,
          adresse: true,
          role: true,
          actif: true,
          specialite: true,
        },
      },
    } : undefined;

    if (config.paged || query.page !== undefined || query.size !== undefined) {
      const page = this.toInt(query.page, 0);
      const size = this.toInt(query.size, 20);
      const [content, totalElements] = await Promise.all([
        delegate.findMany({ where, skip: page * size, take: size, orderBy, ...(include ? { include } : {}) }),
        delegate.count({ where }),
      ]);
      const totalPages = size > 0 ? Math.ceil(totalElements / size) : 0;
      return {
        content: content.map((item: Payload) => this.sanitizeEntity(config.model, item)),
        page,
        size,
        totalElements,
        totalPages,
        first: page === 0,
        last: page >= totalPages - 1 || totalPages === 0,
      };
    }

    const rows = await delegate.findMany({ where, orderBy, ...(include ? { include } : {}) });
    return rows.map((item: Payload) => this.sanitizeEntity(config.model, item));
  }

  async findOne(config: CrudConfig, tenantId: string | undefined, id: string) {
    this.assertUuid(id, 'id');
    const include = config.model === 'classe' ? {
      niveau: { include: { cycle: true } },
      anneeAcademique: true,
      professeurResponsable: true,
      salle: true,
      stagiaires: { include: { stagiaire: true } },
      _count: { select: { eleves: true } }
    } : config.model === 'matiereClasse' ? {
      matiere: true,
      enseignant: true
    } : config.model === 'personnel' ? {
      utilisateur: {
        select: {
          id: true,
          username: true,
          email: true,
          firstName: true,
          lastName: true,
          telephone: true,
          adresse: true,
          role: true,
          actif: true,
          specialite: true,
        },
      },
    } : undefined;

    const entity = await this.delegate(config.model).findFirst({
      where: { id, ...this.fixedWhere(config, tenantId) },
      ...(include ? { include } : {}),
    });
    if (!entity) throw new NotFoundException('Ressource introuvable');
    return this.sanitizeEntity(config.model, entity);
  }

  async create(config: CrudConfig, tenantId: string | undefined, body: Payload, userId?: string) {
    const parentIds = this.extractStringArray(body.parentIds).map((parentId, index) =>
      this.assertUuid(parentId, `parentIds[${index}]`),
    );
    const stagiaireIds = config.model === 'classe' && Array.isArray(body.stagiaireIds)
      ? body.stagiaireIds.map(String).map((id, index) => this.assertUuid(id, `stagiaireIds[${index}]`))
      : undefined;

    const data = await this.prepareData(config, tenantId, body, true, userId);
    const tempPassword = typeof data.__tempPasswordForNotification === 'string'
      ? data.__tempPasswordForNotification
      : null;
    delete data.__tempPasswordForNotification;
    const created = await this.delegate(config.model).create({ data });

    if (config.model === 'user' && data.role === 'ELEVE' && parentIds.length > 0) {
      await this.prisma.eleveParent.createMany({
        data: parentIds.map((parentId) => ({ eleveId: created.id, parentId })),
        skipDuplicates: true,
      });
    }

    if (config.model === 'inscription') {
      await this.syncEleveClasse(created.eleveId, created.classeId);
    }

    if (config.model === 'note') {
      await this.refreshBulletinsForNote(tenantId, created.eleveId, created.trimestre, created.anneeScolaire);
    }

    if (config.model === 'bulletin') {
      return this.attachBulletinPdf(tenantId, created);
    }

    if (config.model === 'classe' && stagiaireIds && stagiaireIds.length > 0) {
      await this.prisma.classeStagiaire.createMany({
        data: stagiaireIds.map((stagiaireId) => ({
          tenantId: tenantId ?? '',
          classeId: created.id,
          stagiaireId,
        })),
        skipDuplicates: true,
      });
    }

    if (config.model === 'classe') {
      return this.findOne(config, tenantId, created.id);
    }

    if (config.model === 'user' && data.role === 'ENSEIGNANT' && tempPassword) {
      void this.sendTeacherCredentials(tenantId, created, tempPassword);
    }

    return this.sanitizeEntity(config.model, created);
  }

  async update(config: CrudConfig, tenantId: string | undefined, id: string, body: Payload) {
    await this.findOne(config, tenantId, id);
    const stagiaireIds = config.model === 'classe' && Array.isArray(body.stagiaireIds)
      ? body.stagiaireIds.map(String).map((id, index) => this.assertUuid(id, `stagiaireIds[${index}]`))
      : undefined;

    const data = await this.prepareData(config, tenantId, body, false);
    const updated = await this.delegate(config.model).update({ where: { id }, data });

    if (config.model === 'inscription') {
      await this.syncEleveClasse(updated.eleveId, updated.classeId);
    }

    if (config.model === 'note') {
      await this.refreshBulletinsForNote(tenantId, updated.eleveId, updated.trimestre, updated.anneeScolaire);
    }

    if (config.model === 'bulletin') {
      return this.attachBulletinPdf(tenantId, updated);
    }

    if (config.model === 'classe' && stagiaireIds !== undefined) {
      await this.prisma.classeStagiaire.deleteMany({ where: { classeId: id } });
      if (stagiaireIds.length > 0) {
        await this.prisma.classeStagiaire.createMany({
          data: stagiaireIds.map((stagiaireId) => ({
            tenantId: tenantId ?? '',
            classeId: id,
            stagiaireId,
          })),
          skipDuplicates: true,
        });
      }
    }

    if (config.model === 'classe') {
      return this.findOne(config, tenantId, id);
    }

    return this.sanitizeEntity(config.model, updated);
  }

  async delete(config: CrudConfig, tenantId: string | undefined, id: string) {
    await this.findOne(config, tenantId, id);
    await this.delegate(config.model).delete({ where: { id } });
  }

  findCurrentAnnee(tenantId: string | undefined) {
    return this.prisma.anneeAcademique.findFirst({
      where: { tenantId, estCourante: true, actif: true },
      orderBy: { dateDebut: 'desc' },
    });
  }

  async activateAnnee(tenantId: string | undefined, id: string) {
    await this.prisma.anneeAcademique.updateMany({ where: { tenantId }, data: { estCourante: false } });
    return this.prisma.anneeAcademique.update({ where: { id }, data: { estCourante: true } });
  }

  getBatimentSalles(tenantId: string | undefined, batimentId: string) {
    return this.prisma.salle.findMany({ where: { tenantId, batimentId }, orderBy: { nom: 'asc' } });
  }

  async transferInscription(tenantId: string | undefined, id: string, classeId: string) {
    await this.findOne(V1_RESOURCES.inscriptions, tenantId, id);
    this.assertUuid(classeId, 'classeId');
    const updated = await this.prisma.inscription.update({ where: { id }, data: { classeId, statut: 'TRANSFERE' } });
    await this.syncEleveClasse(updated.eleveId, classeId);
    return updated;
  }

  async approveAbsenceEleve(tenantId: string | undefined, id: string, userId?: string) {
    await this.findOne(V1_RESOURCES['absences-eleves'], tenantId, id);
    return this.prisma.absenceEleve.update({
      where: { id },
      data: { statut: 'JUSTIFIEE', justifiee: true, approuvePar: userId },
    });
  }

  async rejectAbsenceEleve(tenantId: string | undefined, id: string, userId?: string) {
    await this.findOne(V1_RESOURCES['absences-eleves'], tenantId, id);
    return this.prisma.absenceEleve.update({
      where: { id },
      data: { statut: 'NON_JUSTIFIEE', justifiee: false, approuvePar: userId },
    });
  }

  async validateAbsencePersonnel(tenantId: string | undefined, id: string, userId?: string) {
    await this.findOne(V1_RESOURCES['absences-personnel'], tenantId, id);
    return this.prisma.absencePersonnel.update({
      where: { id },
      data: { statut: 'APPROUVEE', validePar: userId },
    });
  }

  async refuseAbsencePersonnel(tenantId: string | undefined, id: string) {
    await this.findOne(V1_RESOURCES['absences-personnel'], tenantId, id);
    return this.prisma.absencePersonnel.update({ where: { id }, data: { statut: 'REJETEE' } });
  }

  async compteRenduConvocation(tenantId: string | undefined, id: string, compteRendu?: string) {
    await this.findOne(V1_RESOURCES.convocations, tenantId, id);
    return this.prisma.convocation.update({
      where: { id },
      data: { compteRendu, statut: compteRendu ? 'TRAITEE' : undefined },
    });
  }

  async submitAppel(tenantId: string | undefined, id: string) {
    await this.findOne(V1_RESOURCES.appels, tenantId, id);
    return this.prisma.appel.update({ where: { id }, data: { statut: 'SOUMIS' } });
  }

  async resetPassword(tenantId: string | undefined, id: string) {
    await this.findOne(V1_RESOURCES.utilisateurs, tenantId, id);
    const tempPassword = this.generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    await this.prisma.user.update({ where: { id }, data: { passwordHash, mustChangePwd: true } });
    return { tempPassword };
  }

  async assignCycles(tenantId: string | undefined, surveillantId: string, cycleIds: string[]) {
    await this.prisma.surveillantCycle.deleteMany({ where: { surveillantId } });
    if (cycleIds.length > 0) {
      await this.prisma.surveillantCycle.createMany({
        data: cycleIds.map((cycleId) => ({ tenantId: tenantId ?? '', surveillantId, cycleId })),
        skipDuplicates: true,
      });
    }
    return { assigned: true };
  }

  async removeCycle(surveillantId: string, cycleId: string) {
    await this.prisma.surveillantCycle.deleteMany({ where: { surveillantId, cycleId } });
  }

  async statsEtablissement(tenantId: string | undefined) {
    const [
      eleves,
      enseignants,
      parents,
      classes,
      salles,
      inscriptionsActives,
      paiements,
      absencesEleves,
      notes,
      elevesParClasse,
      enseignantsParSpecialite,
    ] = await Promise.all([
      this.prisma.user.count({ where: { tenantId, role: 'ELEVE' } }),
      this.prisma.user.count({ where: { tenantId, role: 'ENSEIGNANT' } }),
      this.prisma.user.count({ where: { tenantId, role: 'PARENT' } }),
      this.prisma.classe.count({ where: { tenantId } }),
      this.prisma.salle.count({ where: { tenantId } }),
      this.prisma.inscription.count({ where: { tenantId, statut: 'ACTIF' } }),
      this.prisma.paiement.aggregate({ where: { tenantId, statut: 'VALIDE' }, _sum: { montant: true } }),
      this.prisma.absenceEleve.count({ where: { tenantId } }),
      this.prisma.note.aggregate({ where: { tenantId }, _avg: { note: true }, _count: true }),
      this.prisma.classe.findMany({
        where: { tenantId },
        select: { id: true, nom: true, _count: { select: { eleves: true, inscriptions: true } } },
        orderBy: { nom: 'asc' },
      }),
      this.prisma.user.groupBy({
        by: ['specialite'],
        where: { tenantId, role: 'ENSEIGNANT' },
        _count: { _all: true },
      }),
    ]);
    return {
      eleves,
      enseignants,
      parents,
      classes,
      salles,
      inscriptionsActives,
      absencesEleves,
      moyenneNotes: notes._avg.note ?? 0,
      nombreNotes: notes._count,
      montantPaiements: paiements._sum.montant ?? 0,
      elevesParClasse: elevesParClasse.map((classe) => ({
        classeId: classe.id,
        classeNom: classe.nom,
        eleves: classe._count.eleves,
        inscriptions: classe._count.inscriptions,
      })),
      enseignantsParSpecialite: enseignantsParSpecialite.map((item) => ({
        specialite: item.specialite ?? 'NON_RENSEIGNEE',
        total: item._count._all,
      })),
    };
  }

  async parentChildren(parentId: string) {
    const links = await this.prisma.eleveParent.findMany({
      where: { parentId },
      include: { eleve: true },
    });
    return links.map((link) => this.sanitizeEntity('user', link.eleve));
  }

  async adminParentChildren(tenantId: string | undefined, parentId: string) {
    this.assertUuid(parentId, 'parentId');
    const links = await this.prisma.eleveParent.findMany({
      where: {
        parentId,
        parent: {
          tenantId,
          role: 'PARENT',
        },
        eleve: {
          tenantId,
          role: 'ELEVE',
        },
      },
      include: {
        eleve: {
          include: {
            eleveClasse: {
              select: {
                id: true,
                nom: true,
              },
            },
          },
        },
      },
      orderBy: {
        eleve: {
          lastName: 'asc',
        },
      },
    });
    return links.map((link) => this.sanitizeEntity('user', link.eleve));
  }

  async rapportPointages(tenantId: string | undefined, query: QueryParams) {
    const debut = this.first(query.debut);
    const fin = this.first(query.fin);
    const where = {
      tenantId,
      ...(debut || fin
        ? {
            dateHeure: {
              ...(debut ? { gte: new Date(debut) } : {}),
              ...(fin ? { lte: new Date(fin) } : {}),
            },
          }
        : {}),
    };
    const [total, entrees, sorties] = await Promise.all([
      this.prisma.pointage.count({ where }),
      this.prisma.pointage.count({ where: { ...where, typePointage: 'ENTREE' } }),
      this.prisma.pointage.count({ where: { ...where, typePointage: 'SORTIE' } }),
    ]);
    return { total, entrees, sorties };
  }

  async createLienPaiement(tenantId: string | undefined, body: Payload) {
    return this.prisma.lienPaiementParent.create({
      data: {
        tenantId: tenantId ?? String(body.tenantId ?? ''),
        parentId: String(body.parentId),
        token: randomBytes(32).toString('hex'),
        montantTotal: Number(body.montantTotal ?? body.montant ?? 0),
        mois: String(body.mois ?? new Date().toISOString().slice(0, 7)),
        expiresAt: body.expiresAt ? new Date(String(body.expiresAt)) : new Date(Date.now() + 7 * 86400000),
      },
    });
  }

  getLienPaiement(token: string) {
    return this.prisma.lienPaiementParent.findUnique({ where: { token } });
  }

  async payerLienPaiement(token: string) {
    return this.prisma.lienPaiementParent.update({ where: { token }, data: { statut: 'PAYE' } });
  }

  async createLienBulletin(tenantId: string | undefined, body: Payload) {
    const bulletinId = body.bulletinId
      ? this.assertUuid(body.bulletinId, 'bulletinId')
      : await this.findLatestBulletinId(tenantId, body);
    const parentId = body.parentId
      ? this.assertUuid(body.parentId, 'parentId')
      : await this.findFirstParentIdForBulletin(bulletinId);

    return this.prisma.lienBulletinParent.create({
      data: {
        tenantId: tenantId ?? String(body.tenantId ?? ''),
        bulletinId,
        parentId,
        token: randomBytes(32).toString('hex'),
        expiresAt: body.expiresAt ? new Date(String(body.expiresAt)) : new Date(Date.now() + 7 * 86400000),
      },
    });
  }

  async getLienBulletin(token: string) {
    const lien = await this.prisma.lienBulletinParent.findUnique({
      where: { token },
      include: { bulletin: true },
    });
    return lien?.bulletin ?? lien;
  }

  async getBulletinDownload(tenantId: string | undefined, id: string) {
    const bulletin = await this.findOne(V1_RESOURCES.bulletins, tenantId, id);
    const withPdf =
      (bulletin as Record<string, unknown>).fichierPdfUrl
        ? bulletin
        : await this.attachBulletinPdf(tenantId, bulletin as Record<string, any>);
    return {
      id,
      format: 'pdf',
      url: (withPdf as Record<string, unknown>).fichierPdfUrl,
      fichierPdfUrl: (withPdf as Record<string, unknown>).fichierPdfUrl,
    };
  }

  async generateBulletinsForClasse(tenantId: string | undefined, body: Payload, userId?: string) {
    if (!tenantId) throw new NotFoundException('Tenant introuvable');
    const academicYear = await this.ensureCurrentAcademicYear(tenantId);
    const classeId = this.assertUuid(body.classeId, 'classeId');
    const trimestre = this.normalizeTrimestre(body.trimestre);
    const anneeScolaire = String(body.anneeScolaire ?? academicYear.libelle);
    const anneeAcademiqueId = body.anneeAcademiqueId
      ? this.assertUuid(body.anneeAcademiqueId, 'anneeAcademiqueId')
      : academicYear.id;

    const inscriptions = await this.prisma.inscription.findMany({
      where: {
        tenantId,
        classeId,
        statut: 'ACTIF',
        anneeAcademiqueId,
      },
    });

    const bulletins: unknown[] = [];
    for (const inscription of inscriptions) {
      const { moyenne } = await this.computeStudentAverage(tenantId, inscription.eleveId, trimestre, anneeScolaire);
      const absences = await this.prisma.absenceEleve.count({ where: { tenantId, eleveId: inscription.eleveId } });
      const retards = await this.prisma.absenceEleve.count({
        where: { tenantId, eleveId: inscription.eleveId, typeAbsence: 'RETARD' },
      });

      const existing = await this.prisma.bulletin.findFirst({
        where: { tenantId, eleveId: inscription.eleveId, classeId, trimestre, anneeScolaire },
      });

      const data = {
        moyenne,
        totalEleves: inscriptions.length,
        nombreAbsences: absences,
        nombreRetards: retards,
        moyenneClasse: 0,
        soumisPar: userId,
      };

      const bulletin = existing
        ? await this.prisma.bulletin.update({ where: { id: existing.id }, data })
        : await this.prisma.bulletin.create({
            data: {
              tenantId,
              eleveId: inscription.eleveId,
              classeId,
              trimestre,
              anneeScolaire,
              statut: 'BROUILLON',
              ...data,
            },
          });

      bulletins.push(await this.attachBulletinPdf(tenantId, bulletin));
    }

    await this.updateBulletinRanks(tenantId, classeId, trimestre, anneeScolaire);
    return bulletins;
  }

  private getConfig(configs: Record<string, CrudConfig>, resource: string): CrudConfig {
    const config = configs[resource];
    if (!config) throw new NotFoundException('Endpoint introuvable');
    return config;
  }

  private delegate(model: string) {
    return (this.prisma as unknown as Record<string, any>)[model];
  }

  private assertUuid(value: unknown, field: string): string {
    const uuid = String(value ?? '').trim();
    const uuidPattern =
      /^(?:00000000-0000-0000-0000-000000000000|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
    if (!uuidPattern.test(uuid)) {
      throw new BadRequestException(`${field} invalide: UUID attendu`);
    }
    return uuid;
  }

  private validateUuidFields(data: Payload, fields: string[]): void {
    for (const field of fields) {
      if (data[field] !== undefined && data[field] !== null && data[field] !== '') {
        data[field] = this.assertUuid(data[field], field);
      }
    }
  }

  private normalizeGenre(value: unknown): 'M' | 'F' | 'AUTRE' | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const raw = String(value).trim().toUpperCase();
    if (['M', 'MASCULIN', 'HOMME', 'MALE'].includes(raw)) return 'M';
    if (['F', 'FEMININ', 'FÉMININ', 'FEMME', 'FEMALE'].includes(raw)) return 'F';
    if (raw === 'AUTRE') return 'AUTRE';
    throw new BadRequestException('genre invalide: valeurs autorisées M, F, AUTRE');
  }

  private buildWhere(config: CrudConfig, tenantId: string | undefined, query: QueryParams): Payload {
    const where = this.fixedWhere(config, tenantId);
    for (const [key, raw] of Object.entries(query)) {
      if (['page', 'size', 'sortBy', 'sort', 'asc', 'ascending', 'order', 'search'].includes(key)) continue;
      const value = this.first(raw);
      if (value !== undefined && value !== '') where[key] = value;
    }
    return where;
  }

  private fixedWhere(config: CrudConfig, tenantId: string | undefined): Payload {
    if (config.tenantScoped && !tenantId) {
      throw new BadRequestException('tenantId requis');
    }
    return {
      ...(config.tenantScoped ? { tenantId: this.assertUuid(tenantId, 'tenantId') } : {}),
      ...(config.role ? { role: config.role } : {}),
    };
  }

  private orderBy(config: CrudConfig, query: QueryParams) {
    const sortBy = this.first(query.sortBy) ?? this.first(query.sort);
    if (sortBy) {
      const direction = this.first(query.asc) === 'false' || this.first(query.ascending) === 'false' ? 'desc' : 'asc';
      return { [sortBy]: direction };
    }
    return config.defaultOrderBy ?? { createdAt: 'desc' };
  }

  private async prepareData(
    config: CrudConfig,
    tenantId: string | undefined,
    body: Payload,
    create: boolean,
    userId?: string,
  ): Promise<Payload> {
    const data: Payload = { ...body };
    if (create) delete data.id;
    if (config.tenantScoped && create) {
      data.tenantId = this.assertUuid(tenantId ?? data.tenantId, 'tenantId');
    }
    if (config.role) data.role = config.role;

    for (const field of config.dateFields ?? []) {
      if (data[field]) data[field] = new Date(String(data[field]));
    }

    if (config.model === 'user') {
      if (data.email) data.email = String(data.email).trim().toLowerCase();

      const incomingFirstName = data.firstName ?? data.prenom ?? data.first_name;
      const incomingLastName = data.lastName ?? data.nom ?? data.last_name;
      if (create || incomingFirstName !== undefined) {
        data.firstName = String(incomingFirstName ?? '').trim();
      }
      if (create || incomingLastName !== undefined) {
        data.lastName = String(incomingLastName ?? '').trim();
      }

      data.genre = this.normalizeGenre(data.genre ?? data.sexe);
      if (data.active !== undefined) data.actif = Boolean(data.active);
      if (data.statut !== undefined) data.actif = String(data.statut).toLowerCase() !== 'inactif';
      if (create) {
        data.username = await this.generateUsername(
          tenantId ?? String(data.tenantId ?? ''),
          String(data.firstName),
          String(data.lastName),
        );
        data.email ??= `${data.username}@local.noura-school`;
        const generatedPassword = String(data.password ?? data.motDePasse ?? this.generateTempPassword());
        data.passwordHash ??= await bcrypt.hash(generatedPassword, 12);
        data.__tempPasswordForNotification = generatedPassword;
        data.mustChangePwd ??= true;
        if (data.role === 'ENSEIGNANT') {
          data.matricule = await this.generateMatricule(tenantId ?? String(data.tenantId ?? ''), 'ENS');
          data.dateEmbauche ??= new Date();
          data.mustChangePwd = true;
        }
      }
      for (const field of ['dateNaissance', 'dateInscription', 'dateEmbauche']) {
        if (data[field]) data[field] = new Date(String(data[field]));
      }
      delete data.password;
      delete data.motDePasse;
      delete data.nom;
      delete data.prenom;
      delete data.first_name;
      delete data.last_name;
      delete data.sexe;
      delete data.parentIds;
      delete data.active;
      delete data.statut;
      delete data.generatedUsername;
      delete data.generatedPassword;
      delete data.matieresEnseignees;
      delete data.classesAssignees;
      delete data.salaire;
    }

    if (config.model === 'inscription' && create) {
      data.anneeAcademiqueId ??= (await this.ensureCurrentAcademicYear(tenantId ?? String(data.tenantId ?? ''))).id;
      data.numeroInscription ??= `INS-${Date.now().toString(36).toUpperCase()}`;
      data.creePar ??= userId ?? data.utilisateurId ?? '00000000-0000-0000-0000-000000000000';
      data.statut ??= 'ACTIF';
    }

    if (config.model === 'note') {
      await this.normalizeNoteData(tenantId ?? String(data.tenantId ?? ''), data);
    }

    if (config.model === 'matiere') {
      delete data.coefficient;
    }

    if (config.model === 'bulletin') {
      await this.normalizeBulletinData(tenantId ?? String(data.tenantId ?? ''), data, userId);
    }

    if (config.model === 'paiement' && create) {
      data.reference ??= `PAY-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
      data.statut ??= 'VALIDE';
      data.datePaiement ??= new Date();
    }

    if (config.model === 'absenceEleve' && create) {
      data.date = data.date ? new Date(String(data.date)) : new Date();
      data.typeAbsence ??= 'ABSENT';
      data.statut ??= 'EN_ATTENTE';
      data.justifiee ??= false;
    }

    if (config.model === 'convocation' && create) data.statut ??= 'EN_ATTENTE';
    if (config.model === 'appel' && create) data.statut ??= 'BROUILLON';
    if (config.model === 'absencePersonnel' && create) data.statut ??= 'EN_ATTENTE';
    if (config.model === 'pointage' && create) data.createdBy ??= userId;

    if (config.model === 'classe') {
      await this.normalizeClasseData(tenantId ?? String(data.tenantId ?? ''), data);
    }

    if (config.model === 'cours') {
      await this.normalizeCoursData(tenantId ?? String(data.tenantId ?? ''), data);
    }

    if (config.model === 'salle') {
      this.normalizeSalleData(data);
    }

    if (config.model === 'absencePersonnel') {
      this.normalizeAbsencePersonnelData(data);
    }

    if (config.model === 'personnel') {
      await this.normalizePersonnelData(tenantId ?? String(data.tenantId ?? ''), data);
    }

    this.validateModelUuids(config.model, data);

    return this.stripUndefined(data);
  }

  private async sendTeacherCredentials(tenantId: string | undefined, user: Payload, tempPassword: string): Promise<void> {
    const email = String(user.email ?? '');
    const firstName = String(user.firstName ?? '');
    const lastName = String(user.lastName ?? '');
    const from = tenantId ? await this.resolveSchoolSender(tenantId) : undefined;

    if (email) {
      this.mailService.sendCompteCree(email, firstName, lastName, tempPassword, from);
    }

    const telephone = String(user.telephone ?? '').trim();
    if (!tenantId || !telephone || !this.whatsappService.isReady(tenantId)) {
      return;
    }

    const message = [
      'NouraSchool - Accès professeur',
      `Login: ${email}`,
      `Mot de passe: ${tempPassword}`,
      'À changer à la première connexion.',
    ].join('\n');

    this.whatsappService.sendMessage(tenantId, telephone, message).catch(() => null);
  }

  private sanitizeEntity(model: string, entity: Payload): Payload {
    if (!entity || model !== 'user') return entity;
    const { passwordHash: _passwordHash, ...safeEntity } = entity;
    return safeEntity;
  }

  private async resolveSchoolSender(tenantId: string): Promise<string | undefined> {
    const [config, tenant] = await Promise.all([
      this.prisma.ecoleConfig.findUnique({ where: { tenantId }, select: { nom: true } }),
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { nom: true, slug: true } }),
    ]);

    const schoolName = config?.nom || tenant?.nom || 'Noura School';
    const localDomain = tenant?.slug || this.schoolDomainName(schoolName);
    return `${schoolName} <contact@${localDomain}.assanediallo.com>`;
  }

  private schoolDomainName(schoolName: string): string {
    const normalized = schoolName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    const compact = normalized.replace(/[^a-z0-9]/g, '');
    if (compact.length > 0 && compact.length <= 15) {
      return compact;
    }

    const initials = normalized
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .map((word) => word[0])
      .join('');

    return initials || compact.slice(0, 15) || 'nouraschool';
  }

  private validateModelUuids(model: string, data: Payload): void {
    const common = ['tenantId'];
    const fieldsByModel: Record<string, string[]> = {
      user: [...common, 'classeId'],
      inscription: [...common, 'eleveId', 'classeId', 'anneeAcademiqueId', 'creePar'],
      note: [...common, 'eleveId', 'matiereId'],
      bulletin: [...common, 'eleveId', 'classeId', 'soumisPar', 'validePar'],
      paiement: [...common, 'inscriptionId', 'eleveId', 'parentId', 'validePar'],
      absenceEleve: [...common, 'eleveId', 'classeId', 'approuvePar'],
      emploiDuTemps: [...common, 'classeId', 'coursId', 'salleId', 'enseignantId', 'matiereId'],
      appel: [...common, 'coursId', 'classeId', 'soumisPar'],
      cahierTexte: [...common, 'coursId'],
      convocation: [...common, 'parentId', 'eleveId'],
      notification: [...common, 'destinataireId'],
      reclamation: [...common, 'eleveId', 'noteId'],
      matiereClasse: [...common, 'matiereId', 'classeId', 'enseignantId', 'anneeAcademiqueId'],
      calendrierScolaire: common,
      personnel: [...common, 'utilisateurId'],
      pointage: [...common, 'personnelId', 'createdBy'],
      absencePersonnel: [...common, 'personnelId', 'validePar'],
    };

    this.validateUuidFields(data, fieldsByModel[model] ?? common);
  }

  private async normalizeClasseData(tenantId: string, data: Payload): Promise<void> {
    if (!data.niveauId && data.niveau) {
      const niveauInput = String(data.niveau).trim();
      if (this.isUuidLike(niveauInput)) {
        data.niveauId = niveauInput;
      } else if (niveauInput) {
        const niveau = await this.prisma.niveau.findFirst({
          where: {
            tenantId,
            OR: [{ libelle: niveauInput }, { code: niveauInput }],
          },
        });
        if (niveau) {
          data.niveauId = niveau.id;
        }
      }
    }

    if (!data.anneeAcademiqueId && data.anneeScolaire) {
      const anneeInput = String(data.anneeScolaire).trim();
      if (this.isUuidLike(anneeInput)) {
        data.anneeAcademiqueId = anneeInput;
      } else if (anneeInput) {
        const annee = await this.prisma.anneeAcademique.findFirst({
          where: { tenantId, libelle: anneeInput },
        });
        if (annee) {
          data.anneeAcademiqueId = annee.id;
        }
      }
    }

    if (!data.salleId && data.salleClasse) {
      const salleInput = String(data.salleClasse).trim();
      if (this.isUuidLike(salleInput)) {
        data.salleId = salleInput;
      } else if (salleInput) {
        const salle = await this.prisma.salle.findFirst({
          where: { tenantId, nom: salleInput },
        });
        if (salle) {
          data.salleId = salle.id;
        }
      }
    }

    if (data.nombreMaxEleves !== undefined && data.effectifMax === undefined) {
      data.effectifMax = Number(data.nombreMaxEleves);
    }

    delete data.niveau;
    delete data.anneeScolaire;
    delete data.salleClasse;
    delete data.nombreMaxEleves;
    delete data.enseignantPrincipalId;
    delete data.elevesIds;
    delete data.matieres;
    delete data.salle;
    delete data.horaires;
    delete data.stagiaireIds;
    delete data.stagiaires;
  }

  private async normalizeCoursData(tenantId: string, data: Payload): Promise<void> {
    if (!data.matiereId && data.titre) {
      const titre = String(data.titre).trim();
      const matiere = await this.prisma.matiere.findFirst({
        where: {
          tenantId,
          OR: [{ libelle: titre }, { code: titre }],
        },
      });
      if (matiere) {
        data.matiereId = matiere.id;
      }
    }

    if (data.heures !== undefined && data.volumeHoraireHebdo === undefined) {
      const heures = Number(data.heures);
      if (!Number.isNaN(heures)) {
        data.volumeHoraireHebdo = heures;
      }
    }

    if (data.description && data.coefficient === undefined) {
      delete data.description;
    }

    delete data.titre;
    delete data.dateDebut;
    delete data.dateFin;
    delete data.heures;
  }

  private normalizeSalleData(data: Payload): void {
    if (data.type !== undefined && data.typeSalle === undefined) {
      data.typeSalle = String(data.type);
    }
    if (data.capacite !== undefined) {
      const capacite = Number(data.capacite);
      data.capacite = Number.isNaN(capacite) ? undefined : capacite;
    }
    delete data.type;
  }

  private normalizeAbsencePersonnelData(data: Payload): void {
    if (data.type !== undefined && data.typeAbsence === undefined) {
      data.typeAbsence = String(data.type);
    }
    delete data.type;
  }

  private async normalizePersonnelData(tenantId: string, data: Payload): Promise<void> {
    if ((!data.utilisateurId || !this.isUuidLike(String(data.utilisateurId))) && data.email) {
      const firstName = String(data.prenom ?? data.firstName ?? '').trim();
      const lastName = String(data.nom ?? data.lastName ?? '').trim();
      const email = String(data.email).trim().toLowerCase();
      const role = this.normalizePersonnelRole(data.type);

      const existingUser = await this.prisma.user.findFirst({
        where: { tenantId, email },
      });

      if (existingUser) {
        data.utilisateurId = existingUser.id;
      } else if (firstName && lastName) {
        const username = await this.generateUsername(tenantId, firstName, lastName);
        const generatedPassword = this.generateTempPassword();
        const passwordHash = await bcrypt.hash(generatedPassword, 12);
        const createdUser = await this.prisma.user.create({
          data: {
            tenantId,
            username,
            email,
            passwordHash,
            firstName,
            lastName,
            telephone: data.telephone ? String(data.telephone) : undefined,
            adresse: data.adresse ? String(data.adresse) : undefined,
            role,
            actif: true,
            mustChangePwd: true,
            specialite: data.specialite ? String(data.specialite) : undefined,
          },
        });
        data.utilisateurId = createdUser.id;
      }
    }

    if (data.salaire !== undefined) {
      const salaire = Number(data.salaire);
      data.salaire = Number.isNaN(salaire) ? undefined : salaire;
    }

    if (data.soldeConge !== undefined) {
      const soldeConge = Number(data.soldeConge);
      data.soldeConge = Number.isNaN(soldeConge) ? 0 : soldeConge;
    }

    delete data.prenom;
    delete data.nom;
    delete data.firstName;
    delete data.lastName;
    delete data.email;
    delete data.telephone;
    delete data.adresse;
    delete data.type;
    delete data.specialite;
    delete data.cycleId;
    delete data.matieres;
  }

  private normalizePersonnelRole(value: unknown): 'ENSEIGNANT' | 'SURVEILLANT' | 'CAISSIER' | 'RH' {
    const role = String(value ?? '').trim().toUpperCase();
    if (role === 'ENSEIGNANT') return 'ENSEIGNANT';
    if (role === 'SURVEILLANT') return 'SURVEILLANT';
    if (role === 'CAISSIER') return 'CAISSIER';
    return 'RH';
  }

  private isUuidLike(value: string): boolean {
    return /^(?:00000000-0000-0000-0000-000000000000|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(
      value.trim(),
    );
  }

  private async normalizeNoteData(tenantId: string, data: Payload): Promise<void> {
    this.validateUuidFields(data, ['coursId', 'eleveId', 'matiereId']);
    if (!data.matiereId && data.coursId) {
      const cours = await this.prisma.cours.findFirst({
        where: { id: String(data.coursId), tenantId },
        select: { matiereId: true },
      });
      data.matiereId = cours?.matiereId;
    }

    data.note = this.toNumber(
      data.note ??
        data.valeur ??
        data.moyenne ??
        this.averageDefined([data.ds1, data.ds2, data.composition]),
      0,
    );
    data.noteSur = this.toNumber(data.noteSur, 20);
    data.typeEvaluation ??= data.composition !== undefined ? 'COMPOSITION' : 'DEVOIR';
    data.trimestre = this.normalizeTrimestre(data.trimestre);
    data.anneeScolaire = String(data.anneeScolaire ?? (await this.ensureCurrentAcademicYear(tenantId)).libelle);
    data.dateEvaluation = data.dateEvaluation ? new Date(String(data.dateEvaluation)) : new Date();

    delete data.coursId;
    delete data.valeur;
    delete data.moyenne;
    delete data.ds1;
    delete data.ds2;
    delete data.composition;
    delete data.enseignantId;
    delete data.dateCreation;
    delete data.dateModification;
  }

  private async normalizeBulletinData(tenantId: string, data: Payload, userId?: string): Promise<void> {
    this.validateUuidFields(data, ['eleveId', 'classeId', 'soumisPar', 'validePar']);
    data.trimestre = this.normalizeTrimestre(data.trimestre);
    data.anneeScolaire = String(data.anneeScolaire ?? (await this.ensureCurrentAcademicYear(tenantId)).libelle);
    data.moyenne ??= data.moyenneGenerale;
    data.nombreAbsences = this.toNumber(data.nombreAbsences, 0);
    data.nombreRetards = this.toNumber(data.nombreRetards, 0);
    data.statut ??= 'BROUILLON';
    data.soumisPar ??= userId;

    if (!data.classeId && data.eleveId) {
      const eleve = await this.prisma.user.findFirst({
        where: { id: String(data.eleveId), tenantId },
        select: { classeId: true },
      });
      data.classeId = eleve?.classeId;
    }

    if (data.eleveId && data.classeId && data.moyenne === undefined) {
      const stats = await this.computeStudentAverage(
        tenantId,
        String(data.eleveId),
        String(data.trimestre),
        String(data.anneeScolaire),
      );
      data.moyenne = stats.moyenne;
    }

    if (data.classeId) {
      const classeStats = await this.computeClassBulletinStats(
        tenantId,
        String(data.classeId),
        String(data.trimestre),
        String(data.anneeScolaire),
      );
      data.totalEleves ??= classeStats.totalEleves;
      data.moyenneClasse ??= classeStats.moyenneClasse;
    }

    delete data.moyenneGenerale;
    delete data.eleveNom;
    delete data.classeNom;
  }

  private async ensureCurrentAcademicYear(tenantId: string) {
    const current = await this.prisma.anneeAcademique.findFirst({
      where: { tenantId, estCourante: true, actif: true },
      orderBy: { dateDebut: 'desc' },
    });
    if (current) return current;

    const { libelle, dateDebut, dateFin } = this.currentAcademicYear();
    const existing = await this.prisma.anneeAcademique.findFirst({ where: { tenantId, libelle } });
    if (existing) {
      return this.prisma.anneeAcademique.update({
        where: { id: existing.id },
        data: { estCourante: true, actif: true },
      });
    }

    return this.prisma.anneeAcademique.create({
      data: { tenantId, libelle, dateDebut, dateFin, estCourante: true, actif: true },
    });
  }

  private currentAcademicYear(date = new Date()) {
    const year = date.getUTCFullYear();
    const startYear = date.getUTCMonth() >= 8 ? year : year - 1;
    return {
      libelle: `${startYear}-${startYear + 1}`,
      dateDebut: new Date(Date.UTC(startYear, 8, 1)),
      dateFin: new Date(Date.UTC(startYear + 1, 7, 31)),
    };
  }

  private normalizeTrimestre(value: unknown): string {
    if (value === undefined || value === null || value === '') return 'TRIMESTRE_1';
    const raw = String(value).trim().toUpperCase();
    if (['1', 'T1', 'TRIMESTRE1'].includes(raw)) return 'TRIMESTRE_1';
    if (['2', 'T2', 'TRIMESTRE2'].includes(raw)) return 'TRIMESTRE_2';
    if (['3', 'T3', 'TRIMESTRE3'].includes(raw)) return 'TRIMESTRE_3';
    return raw;
  }

  private async computeStudentAverage(tenantId: string, eleveId: string, trimestre: string, anneeScolaire: string) {
    const notes = await this.prisma.note.findMany({
      where: { tenantId, eleveId, trimestre, anneeScolaire },
    });
    if (notes.length === 0) return { moyenne: 0 };

    const courseCoefficients = await this.findStudentCourseCoefficients(tenantId, eleveId, anneeScolaire);
    let total = 0;
    let coefficients = 0;
    for (const note of notes) {
      const coefficient = courseCoefficients.get(note.matiereId) ?? 1;
      total += ((note.note / note.noteSur) * 20) * coefficient;
      coefficients += coefficient;
    }
    return { moyenne: coefficients ? Math.round((total / coefficients) * 100) / 100 : 0 };
  }

  private async findStudentCourseCoefficients(
    tenantId: string,
    eleveId: string,
    anneeScolaire: string,
  ): Promise<Map<string, number>> {
    const inscription = await this.prisma.inscription.findFirst({
      where: { tenantId, eleveId, anneeAcademique: { libelle: anneeScolaire } },
      select: { classeId: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!inscription?.classeId) return new Map();

    const cours = await this.prisma.cours.findMany({
      where: {
        tenantId,
        classeId: inscription.classeId,
        OR: [
          { anneeAcademique: { libelle: anneeScolaire } },
          { anneeAcademiqueId: null },
        ],
      },
      select: { matiereId: true, coefficient: true },
    });

    return new Map(cours.map((row) => [row.matiereId, row.coefficient ?? 1]));
  }

  private async computeClassBulletinStats(
    tenantId: string,
    classeId: string,
    trimestre: string,
    anneeScolaire: string,
  ) {
    const [totalEleves, aggregate] = await Promise.all([
      this.prisma.inscription.count({ where: { tenantId, classeId, anneeAcademique: { libelle: anneeScolaire } } }),
      this.prisma.bulletin.aggregate({
        where: { tenantId, classeId, trimestre, anneeScolaire, moyenne: { not: null } },
        _avg: { moyenne: true },
      }),
    ]);
    return { totalEleves, moyenneClasse: aggregate._avg.moyenne ?? 0 };
  }

  private async updateBulletinRanks(
    tenantId: string,
    classeId: string,
    trimestre: string,
    anneeScolaire: string,
  ): Promise<void> {
    const bulletins = await this.prisma.bulletin.findMany({
      where: { tenantId, classeId, trimestre, anneeScolaire, moyenne: { not: null } },
      orderBy: { moyenne: 'desc' },
    });
    const moyenneClasse =
      bulletins.length > 0
        ? Math.round((bulletins.reduce((sum, bulletin) => sum + (bulletin.moyenne ?? 0), 0) / bulletins.length) * 100) / 100
        : 0;

    await this.prisma.$transaction(
      bulletins.map((bulletin, index) =>
        this.prisma.bulletin.update({
          where: { id: bulletin.id },
          data: { rang: index + 1, totalEleves: bulletins.length, moyenneClasse },
        }),
      ),
    );
  }

  private async refreshBulletinsForNote(
    tenantId: string | undefined,
    eleveId: string,
    trimestre: string,
    anneeScolaire: string,
  ): Promise<void> {
    if (!tenantId) return;
    const bulletins = await this.prisma.bulletin.findMany({ where: { tenantId, eleveId, trimestre, anneeScolaire } });
    for (const bulletin of bulletins) {
      const { moyenne } = await this.computeStudentAverage(tenantId, eleveId, trimestre, anneeScolaire);
      const updated = await this.prisma.bulletin.update({ where: { id: bulletin.id }, data: { moyenne } });
      await this.attachBulletinPdf(tenantId, updated);
    }
  }

  private async attachBulletinPdf(tenantId: string | undefined, bulletin: Record<string, any>) {
    if (!tenantId) return bulletin;
    const buffer = await this.buildBulletinPdf(tenantId, bulletin);
    const key = this.storage.buildBulletinKey(tenantId, String(bulletin.eleveId), String(bulletin.trimestre));
    const fichierPdfUrl = await this.storage.upload(key, buffer, 'application/pdf');
    return this.prisma.bulletin.update({ where: { id: bulletin.id }, data: { fichierPdfUrl } });
  }

  private async buildBulletinPdf(tenantId: string, bulletin: Record<string, any>): Promise<Buffer> {
    const [eleve, classe, notes] = await Promise.all([
      this.prisma.user.findFirst({ where: { id: String(bulletin.eleveId), tenantId } }),
      this.prisma.classe.findFirst({ where: { id: String(bulletin.classeId), tenantId } }),
      this.prisma.note.findMany({
        where: {
          tenantId,
          eleveId: String(bulletin.eleveId),
          trimestre: String(bulletin.trimestre),
          anneeScolaire: String(bulletin.anneeScolaire),
        },
        include: { matiere: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const lines = [
      'Noura School - Bulletin',
      `Eleve: ${eleve ? `${eleve.firstName} ${eleve.lastName}` : bulletin.eleveId}`,
      `Classe: ${classe?.nom ?? bulletin.classeId ?? '-'}`,
      `Trimestre: ${bulletin.trimestre}`,
      `Annee scolaire: ${bulletin.anneeScolaire}`,
      '',
      'Notes:',
      ...notes.map((note) => `${note.matiere.libelle}: ${note.note}/${note.noteSur} (${note.typeEvaluation})`),
      '',
      `Moyenne generale: ${bulletin.moyenne ?? 0}`,
      `Moyenne classe: ${bulletin.moyenneClasse ?? 0}`,
      `Rang: ${bulletin.rang ?? '-'} / ${bulletin.totalEleves ?? '-'}`,
      `Absences: ${bulletin.nombreAbsences ?? 0}`,
      `Retards: ${bulletin.nombreRetards ?? 0}`,
      `Appreciation: ${bulletin.appreciation ?? '-'}`,
    ];

    return this.simplePdf(lines);
  }

  private simplePdf(lines: string[]): Buffer {
    const escapedLines = lines.map((line) => `(${this.escapePdfText(line)}) Tj T*`).join('\n');
    const stream = `BT /F1 11 Tf 50 790 Td 14 TL\n${escapedLines}\nET`;
    const objects = [
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
      '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
      '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
      '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
      `5 0 obj << /Length ${Buffer.byteLength(stream, 'latin1')} >> stream\n${stream}\nendstream endobj`,
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    for (const object of objects) {
      offsets.push(Buffer.byteLength(pdf, 'latin1'));
      pdf += `${object}\n`;
    }
    const xref = Buffer.byteLength(pdf, 'latin1');
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets.slice(1)) {
      pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer << /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(pdf, 'latin1');
  }

  private escapePdfText(value: string): string {
    return value.replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7E]/g, '');
  }

  private async syncEleveClasse(eleveId?: string, classeId?: string): Promise<void> {
    if (!eleveId || !classeId) return;
    await this.prisma.user.updateMany({ where: { id: eleveId, role: 'ELEVE' }, data: { classeId } });
  }

  private async generateUsername(tenantId: string, firstName: string, lastName: string): Promise<string> {
    const base = this.slugify(`${firstName}.${lastName}`) || `user.${Date.now().toString(36)}`;
    for (let index = 0; index < 20; index += 1) {
      const username = index === 0 ? base : `${base}${index + 1}`;
      const existing = await this.prisma.user.findFirst({ where: { tenantId, username } });
      if (!existing) return username;
    }
    return `${base}${randomBytes(3).toString('hex')}`;
  }

  private async generateMatricule(tenantId: string, prefix: string): Promise<string> {
    const year = new Date().getUTCFullYear();
    for (let index = 0; index < 50; index += 1) {
      const suffix = `${Date.now().toString(36).toUpperCase()}${index ? index.toString().padStart(2, '0') : ''}`;
      const matricule = `${prefix}-${year}-${suffix}`;
      const existing = await this.prisma.user.findFirst({ where: { tenantId, matricule } });
      if (!existing) return matricule;
    }
    return `${prefix}-${year}-${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  private async findLatestBulletinId(tenantId: string | undefined, body: Payload): Promise<string> {
    if (!tenantId) throw new NotFoundException('Tenant introuvable');
    const eleveId = this.assertUuid(body.eleveId, 'eleveId');
    const trimestre = body.trimestre ? this.normalizeTrimestre(body.trimestre) : undefined;
    const bulletin = await this.prisma.bulletin.findFirst({
      where: {
        tenantId,
        eleveId,
        ...(trimestre ? { trimestre } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!bulletin) throw new NotFoundException('Bulletin introuvable pour cet eleve');
    return bulletin.id;
  }

  private async findFirstParentIdForBulletin(bulletinId: string): Promise<string> {
    const bulletin = await this.prisma.bulletin.findUnique({ where: { id: bulletinId }, select: { eleveId: true } });
    if (!bulletin) throw new NotFoundException('Bulletin introuvable');
    const link = await this.prisma.eleveParent.findFirst({
      where: { eleveId: bulletin.eleveId },
    });
    if (!link) throw new BadRequestException('parentId est requis: aucun parent lie a cet eleve');
    return link.parentId;
  }

  private slugify(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.+|\.+$/g, '')
      .slice(0, 80);
  }

  private averageDefined(values: unknown[]): number | undefined {
    const numbers = values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
    if (numbers.length === 0) return undefined;
    return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  }

  private toNumber(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private extractStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item) => item !== undefined && item !== null).map(String);
  }

  private stripUndefined(data: Payload): Payload {
    return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
  }

  private toInt(value: QueryValue, fallback: number): number {
    const parsed = Number(this.first(value));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  private first(value: QueryValue): string | undefined {
    return Array.isArray(value) ? value[0] : value;
  }

  private generateTempPassword(): string {
    return randomBytes(12).toString('base64url');
  }
}
