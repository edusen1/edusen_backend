import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '@/config/prisma.service';
import { StorageService } from '@/infrastructure/storage/storage.service';
import { MailService } from '@/infrastructure/mail/mail.service';
import { WhatsappService } from '@/modules/whatsapp/whatsapp.service';
import type { JwtUser } from '@/common/types/auth.types';
import { normalizePhoneForCountry } from '@/common/utils/phone.util';

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
  professeurs: { model: 'user', tenantScoped: true, role: 'ENSEIGNANT', paged: true },
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
  professeurs: V1_RESOURCES.professeurs,
  parents: V1_RESOURCES.parents,
  classes: V1_RESOURCES.classes,
  matieres: V1_RESOURCES.matieres,
  salles: V1_RESOURCES.salles,
  batiments: V1_RESOURCES.batiments,
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
  annonces: V1_RESOURCES.annonces,
  personnel: V1_RESOURCES.personnel,
  pointages: V1_RESOURCES.pointages,
  'absences-personnel': V1_RESOURCES['absences-personnel'],
  convocations: V1_RESOURCES.convocations,
  cours: V1_RESOURCES.cours,
  inscriptions: V1_RESOURCES.inscriptions,
};

@Injectable()
export class LegacyCrudService {
  private readonly logger = new Logger(LegacyCrudService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly mailService: MailService,
    private readonly whatsappService: WhatsappService,
  ) {}

  async resolveTenantId(tenantId: string | undefined, user?: JwtUser): Promise<string | undefined> {
    const headerTenantId = tenantId?.trim();
    const isUuid = !!headerTenantId
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(headerTenantId);

    if (isUuid) return headerTenantId;
    if (user?.tenantId) return user.tenantId;
    if (!user?.sub) return undefined;

    const dbUser = await this.prisma.user.findFirst({
      where: { id: user.sub },
      select: { tenantId: true },
    });
    return dbUser?.tenantId ?? undefined;
  }

  v1Config(resource: string): CrudConfig {
    return this.getConfig(V1_RESOURCES, resource);
  }

  adminConfig(resource: string): CrudConfig {
    return this.getConfig(ADMIN_RESOURCES, resource);
  }

  async findAll(config: CrudConfig, tenantId: string | undefined, query: QueryParams = {}) {
    const delegate = this.delegate(config.model);
    const where = await this.buildWhere(config, tenantId, query);
    const orderBy = this.orderBy(config, query);

    if (config.model === 'classe' && !where.anneeAcademiqueId) {
      const currentYear = await this.findCurrentAnnee(tenantId);
      if (currentYear) {
        where.anneeAcademiqueId = currentYear.id;
      }
    }

    if (config.model === 'user' && config.role === 'ELEVE') {
      const inscriptionFilter = this.first(query.inscription);
      if (inscriptionFilter && inscriptionFilter !== 'all') {
        const currentYear = await this.findCurrentAnnee(tenantId);
        const activeInscriptions = currentYear
          ? await this.prisma.inscription.findMany({
              where: {
                tenantId: this.assertUuid(tenantId, 'tenantId'),
                anneeAcademiqueId: currentYear.id,
                statut: 'ACTIF',
              },
              select: { eleveId: true },
            })
          : [];
        const ids = activeInscriptions.map((item) => item.eleveId);
        if (inscriptionFilter === 'inscrit') {
          where.id = { in: ids.length ? ids : ['00000000-0000-0000-0000-000000000000'] };
        } else if (inscriptionFilter === 'non_inscrit') {
          where.id = { notIn: ids.length ? ids : [] };
        }
      }
    }

    const include = config.model === 'user' && config.role === 'ELEVE' ? {
      eleveClasse: { select: { id: true, nom: true } },
      elevParents: {
        select: {
          parent: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              telephone: true,
              email: true,
              lienParente: true,
            },
          },
        },
      },
    } : config.model === 'classe' ? {
      niveau: { include: { cycle: true } },
      anneeAcademique: true,
      professeurResponsable: true,
      salle: true,
      stagiaires: { include: { stagiaire: true } },
      _count: { select: { eleves: true } }
    } : config.model === 'inscription' ? {
      classe: { select: { id: true, nom: true } },
      anneeAcademique: { select: { id: true, libelle: true } },
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
          surveillantCycles: {
            select: {
              cycle: { select: { id: true, code: true, libelle: true } },
            },
          },
        },
      },
      niveauAffectations: {
        include: {
          niveau: {
            select: {
              id: true,
              code: true,
              libelle: true,
              ordre: true,
              cycle: { select: { id: true, code: true, libelle: true } },
            },
          },
        },
        orderBy: { ordre: 'asc' },
      },
    } : config.model === 'bulletin' ? {
      classe: { select: { id: true, nom: true } },
    } : config.model === 'absenceEleve' ? {
      classe: { select: { id: true, nom: true } },
    } : config.model === 'cours' ? {
      matiere: { select: { id: true, code: true, libelle: true } },
      classe: { select: { id: true, nom: true } },
      anneeAcademique: { select: { id: true, libelle: true } },
    } : config.model === 'note' ? {
      matiere: { select: { id: true, code: true, libelle: true } },
    } : config.model === 'paiement' ? {
      inscription: {
        include: {
          classe: { select: { id: true, nom: true } },
          anneeAcademique: { select: { id: true, libelle: true } },
          eleve: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              matricule: true,
              telephone: true,
              elevParents: {
                select: {
                  parent: {
                    select: {
                      id: true,
                      firstName: true,
                      lastName: true,
                      telephone: true,
                      lienParente: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    } : undefined;

    if (config.paged || query.page !== undefined || query.size !== undefined) {
      const page = this.toInt(query.page, 0);
      const size = this.toInt(query.size, config.model === 'inscription' ? 10 : 20);
      let [content, totalElements] = await Promise.all([
        delegate.findMany({ where, skip: page * size, take: size, orderBy, ...(include ? { include } : {}) }),
        delegate.count({ where }),
      ]);
      content = await this.attachEleveIfNeeded(config.model, content, tenantId);
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

    let rows = await delegate.findMany({ where, orderBy, ...(include ? { include } : {}) });
    rows = await this.attachEleveIfNeeded(config.model, rows, tenantId);
    return rows.map((item: Payload) => this.sanitizeEntity(config.model, item));
  }

  async findOne(config: CrudConfig, tenantId: string | undefined, id: string) {
    this.assertUuid(id, 'id');
    const include = config.model === 'user' && config.role === 'ELEVE' ? {
      eleveClasse: { select: { id: true, nom: true } },
      elevParents: {
        select: {
          parent: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              telephone: true,
              email: true,
              lienParente: true,
            },
          },
        },
      },
    } : config.model === 'classe' ? {
      niveau: { include: { cycle: true } },
      anneeAcademique: true,
      professeurResponsable: true,
      salle: true,
      stagiaires: { include: { stagiaire: true } },
      _count: { select: { eleves: true } }
    } : config.model === 'inscription' ? {
      classe: { select: { id: true, nom: true } },
      anneeAcademique: { select: { id: true, libelle: true } },
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
          surveillantCycles: {
            select: {
              cycle: { select: { id: true, code: true, libelle: true } },
            },
          },
        },
      },
      niveauAffectations: {
        include: {
          niveau: {
            select: {
              id: true,
              code: true,
              libelle: true,
              ordre: true,
              cycle: { select: { id: true, code: true, libelle: true } },
            },
          },
        },
        orderBy: { ordre: 'asc' },
      },
    } : config.model === 'bulletin' ? {
      classe: { select: { id: true, nom: true } },
    } : config.model === 'absenceEleve' ? {
      classe: { select: { id: true, nom: true } },
    } : config.model === 'cours' ? {
      matiere: { select: { id: true, code: true, libelle: true } },
      classe: { select: { id: true, nom: true } },
      anneeAcademique: { select: { id: true, libelle: true } },
    } : config.model === 'note' ? {
      matiere: { select: { id: true, code: true, libelle: true } },
    } : config.model === 'paiement' ? {
      inscription: {
        include: {
          classe: { select: { id: true, nom: true } },
          anneeAcademique: { select: { id: true, libelle: true } },
          eleve: { select: { id: true, firstName: true, lastName: true, matricule: true } },
        },
      },
    } : undefined;

    const entity = await this.delegate(config.model).findFirst({
      where: { id, ...this.fixedWhere(config, tenantId) },
      ...(include ? { include } : {}),
    });
    if (!entity) throw new NotFoundException('Ressource introuvable');
    const [hydrated] = await this.attachEleveIfNeeded(config.model, [entity], tenantId);
    return this.sanitizeEntity(config.model, hydrated);
  }

  async create(config: CrudConfig, tenantId: string | undefined, body: Payload, userOrId?: string | JwtUser) {
    const userId = typeof userOrId === 'string' ? userOrId : userOrId?.sub;
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
    const personnelNiveauId = typeof data.__personnelNiveauId === 'string' ? data.__personnelNiveauId : null;
    const personnelSectionId = typeof data.__personnelSectionId === 'string' ? data.__personnelSectionId : null;
    const personnelAffectationType = typeof data.__personnelAffectationType === 'string' ? data.__personnelAffectationType : null;
    const personnelAffectationOrdre = typeof data.__personnelAffectationOrdre === 'number' ? data.__personnelAffectationOrdre : 1;
    delete data.__tempPasswordForNotification;
    delete data.__personnelNiveauId;
    delete data.__personnelSectionId;
    delete data.__personnelAffectationType;
    delete data.__personnelAffectationOrdre;

    if (config.model === 'inscription') {
      await this.assertSingleInscriptionPerYear(tenantId, data);
      await this.assertInscriptionClassAllowed(tenantId, data, typeof userOrId === 'string' ? undefined : userOrId);
      const forceImpayes = body.ignoreImpayes === true;
      if (!forceImpayes) {
        await this.assertNoImpayes(tenantId, String(data.eleveId ?? ''));
      }
      if (!data.numeroInscription) {
        data.numeroInscription = this.generateInscriptionNumero(tenantId ?? '');
      }
      if (!data.creePar && userId) data.creePar = userId;
    }

    const created = await this.delegate(config.model).create({ data });

    if (config.model === 'user' && data.role === 'ELEVE' && parentIds.length > 0) {
      await this.prisma.eleveParent.createMany({
        data: parentIds.map((parentId) => ({ eleveId: created.id, parentId })),
        skipDuplicates: true,
      });
    }

    if (config.model === 'inscription') {
      await this.syncEleveClasse(created.eleveId, created.classeId);
      return this.findOne(config, tenantId, created.id);
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

    if (config.model === 'user' && tempPassword) {
      void this.sendUserCredentials(tenantId, created, tempPassword);
    }

    if (config.model === 'personnel') {
      if (personnelSectionId && (personnelAffectationType === 'SURVEILLANT' || personnelAffectationType === 'SECRETAIRE_SURVEILLANT')) {
        await this.replaceSurveillantForCycle(tenantId ?? String(data.tenantId ?? ''), personnelSectionId, String(created.utilisateurId));
      }

      if (tempPassword) {
        void this.sendPersonnelCredentials(tenantId, String(created.utilisateurId), tempPassword);
      }
    }

    return this.sanitizeEntity(config.model, created);
  }

  async update(config: CrudConfig, tenantId: string | undefined, id: string, body: Payload) {
    await this.findOne(config, tenantId, id);
    const stagiaireIds = config.model === 'classe' && Array.isArray(body.stagiaireIds)
      ? body.stagiaireIds.map(String).map((id, index) => this.assertUuid(id, `stagiaireIds[${index}]`))
      : undefined;

    const data = await this.prepareData(config, tenantId, body, false);
    delete data.__tempPasswordForNotification;
    delete data.__personnelNiveauId;
    const personnelUpdateSectionId = typeof data.__personnelSectionId === 'string' ? data.__personnelSectionId : null;
    const personnelUpdateAffectationType = typeof data.__personnelAffectationType === 'string' ? data.__personnelAffectationType : null;
    delete data.__personnelSectionId;
    delete data.__personnelAffectationType;
    delete data.__personnelAffectationOrdre;
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

    if (config.model === 'personnel' && personnelUpdateSectionId && (personnelUpdateAffectationType === 'SURVEILLANT' || personnelUpdateAffectationType === 'SECRETAIRE_SURVEILLANT')) {
      const utilisateurId = String((updated as { utilisateurId: string }).utilisateurId);
      await this.replaceSurveillantForCycle(tenantId ?? '', personnelUpdateSectionId, utilisateurId);
    }

    return this.sanitizeEntity(config.model, updated);
  }

  async delete(config: CrudConfig, tenantId: string | undefined, id: string) {
    if (config.model === 'inscription') {
      throw new BadRequestException('SUPPRESSION_INSCRIPTION_INTERDITE: désactivez l’inscription au lieu de la supprimer');
    }
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

  async desactiverInscription(tenantId: string | undefined, id: string) {
    const inscription = await this.prisma.inscription.findFirst({
      where: { id, ...this.fixedWhere(V1_RESOURCES.inscriptions, tenantId) },
      select: { id: true, eleveId: true, classeId: true },
    });
    if (!inscription) throw new NotFoundException('Inscription introuvable');

    const updated = await this.prisma.inscription.update({
      where: { id },
      data: { statut: 'TERMINE' },
    });
    await this.clearEleveClasseIfCurrent(inscription.eleveId, inscription.classeId);
    return this.findOne(V1_RESOURCES.inscriptions, tenantId, updated.id);
  }

  async reactiverInscription(tenantId: string | undefined, id: string) {
    const inscription = await this.prisma.inscription.findFirst({
      where: { id, ...this.fixedWhere(V1_RESOURCES.inscriptions, tenantId) },
      select: { id: true, eleveId: true, classeId: true },
    });
    if (!inscription) throw new NotFoundException('Inscription introuvable');

    const updated = await this.prisma.inscription.update({
      where: { id },
      data: { statut: 'ACTIF' },
    });
    await this.syncEleveClasse(inscription.eleveId, inscription.classeId);
    return this.findOne(V1_RESOURCES.inscriptions, tenantId, updated.id);
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
    const targetUser = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        telephone: true,
        username: true,
        role: true,
        matricule: true,
      },
    });
    const tempPassword = this.generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    await this.prisma.user.update({ where: { id }, data: { passwordHash, mustChangePwd: true } });
    if (targetUser) {
      void this.sendUserCredentials(tenantId, targetUser as unknown as Payload, tempPassword);
    }
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

  async statsEtablissement(tenantId: string | undefined, user?: JwtUser) {
    const tenantFilter = tenantId ? { tenantId } : {};
    const [
      eleves,
      professeurs,
      parents,
      classes,
      salles,
      inscriptionsActives,
      paiementsValidesAggregate,
      paiementsEnAttente,
      paiementsEnAttenteAggregate,
      paiementsValides,
      absencesEleves,
      absencesEnAttente,
      retardsEleves,
      absencesJustifiees,
      convocationsEnAttente,
      bulletinsValides,
      bulletinsBrouillons,
      notes,
      elevesParClasse,
      professeursParSpecialite,
      paiementsParStatut,
      absencesParStatut,
      bulletinsParStatut,
      derniersPaiements,
      absencesRecentes,
      notificationsNonLues,
    ] = await Promise.all([
      this.prisma.user.count({ where: { ...tenantFilter, role: 'ELEVE' } }),
      this.prisma.user.count({ where: { ...tenantFilter, role: 'ENSEIGNANT' } }),
      this.prisma.user.count({ where: { ...tenantFilter, role: 'PARENT' } }),
      this.prisma.classe.count({ where: tenantFilter }),
      this.prisma.salle.count({ where: tenantFilter }),
      this.prisma.inscription.count({ where: { ...tenantFilter, statut: 'ACTIF' } }),
      this.prisma.paiement.aggregate({ where: { ...tenantFilter, statut: 'VALIDE' }, _sum: { montant: true } }),
      this.prisma.paiement.count({ where: { ...tenantFilter, statut: 'EN_ATTENTE' } }),
      this.prisma.paiement.aggregate({ where: { ...tenantFilter, statut: 'EN_ATTENTE' }, _sum: { montant: true } }),
      this.prisma.paiement.count({ where: { ...tenantFilter, statut: 'VALIDE' } }),
      this.prisma.absenceEleve.count({ where: tenantFilter }),
      this.prisma.absenceEleve.count({ where: { ...tenantFilter, statut: 'EN_ATTENTE' } }),
      this.prisma.absenceEleve.count({ where: { ...tenantFilter, typeAbsence: 'RETARD' } }),
      this.prisma.absenceEleve.count({ where: { ...tenantFilter, justifiee: true } }),
      this.prisma.convocation.count({ where: { ...tenantFilter, statut: 'EN_ATTENTE' } }),
      this.prisma.bulletin.count({ where: { ...tenantFilter, statut: 'VALIDE' } }),
      this.prisma.bulletin.count({ where: { ...tenantFilter, statut: 'BROUILLON' } }),
      this.prisma.note.aggregate({ where: tenantFilter, _avg: { note: true }, _count: true }),
      this.prisma.classe.findMany({
        where: tenantFilter,
        select: { id: true, nom: true, _count: { select: { eleves: true, inscriptions: true } } },
        orderBy: { nom: 'asc' },
      }),
      this.prisma.user.groupBy({
        by: ['specialite'],
        where: { ...tenantFilter, role: 'ENSEIGNANT' },
        _count: { _all: true },
      }),
      this.prisma.paiement.groupBy({
        by: ['statut'],
        where: tenantFilter,
        _count: { _all: true },
        _sum: { montant: true },
      }),
      this.prisma.absenceEleve.groupBy({
        by: ['statut'],
        where: tenantFilter,
        _count: { _all: true },
      }),
      this.prisma.bulletin.groupBy({
        by: ['statut'],
        where: tenantFilter,
        _count: { _all: true },
      }),
      this.prisma.paiement.findMany({
        where: tenantFilter,
        select: {
          id: true,
          reference: true,
          montant: true,
          statut: true,
          typePaiement: true,
          datePaiement: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 6,
      }),
      this.prisma.absenceEleve.findMany({
        where: tenantFilter,
        select: {
          id: true,
          date: true,
          typeAbsence: true,
          statut: true,
          justifiee: true,
          createdAt: true,
          classe: { select: { nom: true } },
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 6,
      }),
      user?.sub
        ? this.prisma.notification.count({
            where: { ...tenantFilter, destinataireId: user.sub, lu: false },
          })
        : Promise.resolve(0),
    ]);
    return {
      eleves,
      professeurs,
      parents,
      classes,
      salles,
      inscriptionsActives,
      absencesEleves,
      absencesEnAttente,
      retardsEleves,
      absencesJustifiees,
      convocationsEnAttente,
      bulletinsValides,
      bulletinsBrouillons,
      notificationsNonLues,
      moyenneNotes: notes._avg.note ?? 0,
      nombreNotes: notes._count,
      montantPaiements: paiementsValidesAggregate._sum.montant ?? 0,
      paiementsEnAttente,
      montantPaiementsEnAttente: paiementsEnAttenteAggregate._sum.montant ?? 0,
      paiementsValides,
      elevesParClasse: elevesParClasse.map((classe) => ({
        classeId: classe.id,
        classeNom: classe.nom,
        eleves: classe._count.eleves,
        inscriptions: classe._count.inscriptions,
      })),
      professeursParSpecialite: professeursParSpecialite.map((item) => ({
        specialite: item.specialite ?? 'NON_RENSEIGNEE',
        total: item._count._all,
      })),
      paiementsParStatut: paiementsParStatut.map((item) => ({
        statut: item.statut,
        total: item._count._all,
        montant: item._sum.montant ?? 0,
      })),
      absencesParStatut: absencesParStatut.map((item) => ({
        statut: item.statut,
        total: item._count._all,
      })),
      bulletinsParStatut: bulletinsParStatut.map((item) => ({
        statut: item.statut,
        total: item._count._all,
      })),
      derniersPaiements,
      absencesRecentes: absencesRecentes.map((absence) => ({
        id: absence.id,
        date: absence.date,
        typeAbsence: absence.typeAbsence,
        statut: absence.statut,
        justifiee: absence.justifiee,
        createdAt: absence.createdAt,
        classeNom: absence.classe?.nom ?? null,
      })),
    };
  }

  async appbarSummary(tenantId: string | undefined, user?: JwtUser) {
    const tenantFilter = tenantId ? { tenantId } : {};
    const userFilter = user?.sub ? { destinataireId: user.sub } : null;

    const [notificationsNonLues, paiementsEnAttente, inscriptionsActives] = await Promise.all([
      userFilter
        ? this.prisma.notification.count({ where: { ...tenantFilter, ...userFilter, lu: false } })
        : Promise.resolve(0),
      this.prisma.paiement.count({ where: { ...tenantFilter, statut: 'EN_ATTENTE' } }),
      this.prisma.inscription.count({ where: { ...tenantFilter, statut: 'ACTIF' } }),
    ]);

    return {
      notificationsNonLues,
      paiementsEnAttente,
      inscriptionsActives,
      messagesNonLus: 0,
    };
  }

  async appbarNotifications(tenantId: string | undefined, user?: JwtUser) {
    if (!user?.sub) {
      return [];
    }

    const tenantFilter = tenantId ? { tenantId } : {};
    return this.prisma.notification.findMany({
      where: { ...tenantFilter, destinataireId: user.sub },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
  }

  async appbarMessages(_tenantId: string | undefined, _user?: JwtUser) {
    return [];
  }

  async markAppbarNotificationRead(tenantId: string | undefined, id: string, user?: JwtUser) {
    this.assertUuid(id, 'id');
    if (!user?.sub) {
      throw new NotFoundException('Notification introuvable');
    }

    const tenantFilter = tenantId ? { tenantId } : {};
    const notification = await this.prisma.notification.findFirst({
      where: { ...tenantFilter, id, destinataireId: user.sub },
      select: { id: true },
    });

    if (!notification) {
      throw new NotFoundException('Notification introuvable');
    }

    return this.prisma.notification.update({
      where: { id },
      data: { lu: true },
    });
  }

  async markAllAppbarNotificationsRead(tenantId: string | undefined, user?: JwtUser) {
    if (!user?.sub) {
      return { updated: 0 };
    }

    const tenantFilter = tenantId ? { tenantId } : {};
    const result = await this.prisma.notification.updateMany({
      where: { ...tenantFilter, destinataireId: user.sub, lu: false },
      data: { lu: true },
    });

    return { updated: result.count };
  }

  async parentChildren(parentId: string) {
    const links = await this.prisma.eleveParent.findMany({
      where: { parentId },
      include: { eleve: true },
    });
    const children = await Promise.all(
      links.map(async (link) => {
        const eleve = this.sanitizeEntity('user', link.eleve) as Payload;
        return {
          ...eleve,
          resumeScolaire: await this.buildEleveResumeScolaire(String(link.eleve.tenantId), String(link.eleve.id)),
        };
      }),
    );

    return children;
  }

  private async buildEleveResumeScolaire(tenantId: string | undefined, eleveId: string) {
    const [bulletins, absences] = await Promise.all([
      this.prisma.bulletin.findMany({
        where: { tenantId, eleveId },
        select: { moyenne: true, appreciation: true, trimestre: true, anneeScolaire: true },
        orderBy: [{ anneeScolaire: 'asc' }, { trimestre: 'asc' }],
      }),
      this.prisma.absenceEleve.findMany({
        where: { tenantId, eleveId },
        select: { typeAbsence: true, justifiee: true },
      }),
    ]);

    const validBulletins = bulletins.filter((bulletin) => typeof bulletin.moyenne === 'number');
    const firstMoyenne = validBulletins[0]?.moyenne ?? null;
    const lastMoyenne = validBulletins[validBulletins.length - 1]?.moyenne ?? null;
    const moyenneGenerale = validBulletins.length
      ? Math.round((validBulletins.reduce((sum, bulletin) => sum + (bulletin.moyenne ?? 0), 0) / validBulletins.length) * 100) / 100
      : null;
    const delta = firstMoyenne !== null && lastMoyenne !== null
      ? Math.round((lastMoyenne - firstMoyenne) * 100) / 100
      : null;
    const totalAbsences = absences.filter((absence) => absence.typeAbsence !== 'RETARD').length;
    const totalRetards = absences.filter((absence) => absence.typeAbsence === 'RETARD').length;
    const appreciationText = bulletins.map((bulletin) => bulletin.appreciation ?? '').join(' ').toLowerCase();
    const negativeBehavior = ['mauvais', 'insuffisant', 'indiscipline', 'retard', 'absent'].some((word) =>
      appreciationText.includes(word),
    );
    const bonComportement = totalAbsences <= 3 && totalRetards <= 3 && !negativeBehavior;

    return {
      moyenneGenerale,
      dernierBulletin: validBulletins[validBulletins.length - 1]
        ? {
            moyenne: validBulletins[validBulletins.length - 1].moyenne,
            trimestre: validBulletins[validBulletins.length - 1].trimestre,
            anneeScolaire: validBulletins[validBulletins.length - 1].anneeScolaire,
          }
        : null,
      evolution:
        delta === null ? 'DONNEES_INSUFFISANTES' :
        delta > 0.5 ? 'PROGRES' :
        delta < -0.5 ? 'REGRESSION' :
        'STABLE',
      evolutionDelta: delta,
      comportement: bonComportement ? 'BON_COMPORTEMENT' : 'A_SURVEILLER',
      commentaireComportement: bonComportement
        ? 'Bon comportement selon les absences, retards et appréciations.'
        : 'Comportement à surveiller selon les absences, retards ou appréciations.',
      totalAbsences,
      totalRetards,
      nombreBulletins: bulletins.length,
    };
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

  async adminEleveParcours(tenantId: string | undefined, eleveId: string) {
    this.assertUuid(eleveId, 'eleveId');
    const eleve = await this.prisma.user.findFirst({
      where: { id: eleveId, tenantId, role: 'ELEVE' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        matricule: true,
        actif: true,
      },
    });
    if (!eleve) throw new NotFoundException('Eleve introuvable');

    const [inscriptions, bulletins, absences, allNotes] = await Promise.all([
      this.prisma.inscription.findMany({
        where: { tenantId, eleveId },
        include: {
          anneeAcademique: { select: { id: true, libelle: true, dateDebut: true, dateFin: true } },
          classe: {
            select: {
              id: true,
              nom: true,
              niveau: {
                select: {
                  id: true,
                  code: true,
                  libelle: true,
                  cycle: { select: { id: true, code: true, libelle: true } },
                },
              },
            },
          },
        },
        orderBy: [{ anneeAcademique: { dateDebut: 'asc' } }, { createdAt: 'asc' }],
      }),
      this.prisma.bulletin.findMany({
        where: { tenantId, eleveId },
        include: {
          classe: { select: { id: true, nom: true } },
        },
        orderBy: [{ anneeScolaire: 'asc' }, { trimestre: 'asc' }],
      }),
      this.prisma.absenceEleve.findMany({
        where: { tenantId, eleveId },
        select: { classeId: true, typeAbsence: true, justifiee: true, statut: true },
      }),
      this.prisma.note.findMany({
        where: { tenantId, eleveId },
        include: { matiere: true },
        orderBy: [{ anneeScolaire: 'asc' }, { trimestre: 'asc' }, { matiere: { libelle: 'asc' } }, { dateEvaluation: 'asc' }],
      }),
    ]);

    const bulletinsByKey = new Map<string, typeof bulletins>();
    for (const bulletin of bulletins) {
      const key = `${bulletin.classeId}:${bulletin.anneeScolaire}`;
      const rows = bulletinsByKey.get(key) ?? [];
      rows.push(bulletin);
      bulletinsByKey.set(key, rows);
    }

    const absencesByClasse = new Map<string, { absences: number; retards: number; justifiees: number }>();
    for (const absence of absences) {
      const stats = absencesByClasse.get(absence.classeId) ?? { absences: 0, retards: 0, justifiees: 0 };
      if (absence.typeAbsence === 'RETARD') stats.retards += 1;
      else stats.absences += 1;
      if (absence.justifiee) stats.justifiees += 1;
      absencesByClasse.set(absence.classeId, stats);
    }

    const classeIds = [...new Set(inscriptions.map((i) => i.classeId))];
    const allCours = await this.prisma.cours.findMany({
      where: { tenantId, classeId: { in: classeIds } },
      include: { matiere: true },
    });
    const coursByClasse = new Map<string, typeof allCours>();
    for (const cours of allCours) {
      const list = coursByClasse.get(cours.classeId) ?? [];
      list.push(cours);
      coursByClasse.set(cours.classeId, list);
    }

    const notesByAnnee = new Map<string, typeof allNotes>();
    for (const note of allNotes) {
      const list = notesByAnnee.get(note.anneeScolaire) ?? [];
      list.push(note);
      notesByAnnee.set(note.anneeScolaire, list);
    }
    const PERIOD_LABELS: Record<string, string> = { SEMESTRE_1: '1er Semestre', SEMESTRE_2: '2ème Semestre', SEMESTRE_3: '3ème Semestre' };
    const buildPeriodes = (annee: string, cycleCode: string, classeId: string) => {
      const yearNotes = notesByAnnee.get(annee) ?? [];
      if (!yearNotes.length) return [];
      const upper = cycleCode.toUpperCase();
      const periods = ['MATERNELLE', 'PRIMAIRE', 'CRECHE'].includes(upper) ? ['SEMESTRE_1', 'SEMESTRE_2', 'SEMESTRE_3'] : ['SEMESTRE_1', 'SEMESTRE_2'];
      const noteScale = ['MATERNELLE', 'PRIMAIRE', 'COLLEGE', 'CRECHE'].includes(upper) ? 10 : 20;
      const subjects = new Map<string, { matiereId: string; libelle: string; code: string; coefficient: number; professeur: string | null }>();
      const coursForClasse = coursByClasse.get(classeId) ?? [];
      for (const cours of coursForClasse) {
        subjects.set(cours.matiereId, {
          matiereId: cours.matiereId, libelle: cours.matiere.libelle, code: cours.matiere.code,
          coefficient: cours.coefficient ?? 1,
          professeur: null,
        });
      }
      for (const note of yearNotes) {
        if (!subjects.has(note.matiereId)) subjects.set(note.matiereId, { matiereId: note.matiereId, libelle: note.matiere.libelle, code: note.matiere.code, coefficient: 1, professeur: null });
      }
      const norm = (n: any) => Number((((n.note ?? 0) / (n.noteSur || noteScale)) * noteScale).toFixed(2));
      const avg = (values: number[]) => values.length ? Number((values.reduce((s, v) => s + v, 0) / values.length).toFixed(2)) : null;
      const wAvg = (rows: { moyenne: number | null; coefficient: number }[]) => {
        const valid = rows.filter((r) => r.moyenne !== null);
        const tc = valid.reduce((s, r) => s + r.coefficient, 0);
        return valid.length && tc > 0 ? Number((valid.reduce((s, r) => s + Number(r.moyenne) * r.coefficient, 0) / tc).toFixed(2)) : null;
      };
      const periodesData = periods.map((periode) => {
        const matieres = [...subjects.values()].map((subject) => {
          const sn = yearNotes.filter((n) => n.trimestre === periode && n.matiereId === subject.matiereId);
          const devoirs = sn.filter((n) => n.typeEvaluation !== 'COMPOSITION').map(norm);
          const comps = sn.filter((n) => n.typeEvaluation === 'COMPOSITION').map(norm);
          const moyenneDevoirs = avg(devoirs);
          const compAvg = avg(comps);
          const moyenne = moyenneDevoirs !== null && compAvg !== null ? Number(((moyenneDevoirs + compAvg) / 2).toFixed(2)) : avg(sn.map(norm));
          return {
            matiereId: subject.matiereId, libelle: subject.libelle, code: subject.code, coefficient: subject.coefficient, professeur: subject.professeur,
            devoirs: sn.filter((n) => n.typeEvaluation !== 'COMPOSITION').map((n) => ({ id: n.id, type: n.typeEvaluation, note: norm(n), noteSur: noteScale, dateEvaluation: n.dateEvaluation?.toISOString() ?? null })),
            composition: sn.filter((n) => n.typeEvaluation === 'COMPOSITION').map((n) => ({ id: n.id, note: norm(n), noteSur: noteScale, dateEvaluation: n.dateEvaluation?.toISOString() ?? null })),
            moyenneDevoirs, moyenne,
          };
        });
        return { code: periode, label: PERIOD_LABELS[periode] ?? periode, moyenne: wAvg(matieres.map((m) => ({ moyenne: m.moyenne, coefficient: m.coefficient }))), matieres };
      });
      return periodesData.filter((p) => p.matieres.some((m) => m.devoirs.length > 0 || m.composition.length > 0));
    };

    const parcours = inscriptions.map((inscription) => {
      const annee = inscription.anneeAcademique.libelle;
      const classeBulletins = bulletinsByKey.get(`${inscription.classeId}:${annee}`) ?? [];
      const moyennes = classeBulletins
        .map((bulletin) => bulletin.moyenne)
        .filter((value): value is number => typeof value === 'number');
      const moyenneClasse = moyennes.length
        ? Math.round((moyennes.reduce((sum, value) => sum + value, 0) / moyennes.length) * 100) / 100
        : null;
      return {
        inscriptionId: inscription.id,
        anneeScolaire: annee,
        statut: inscription.statut,
        classe: inscription.classe,
        absences: absencesByClasse.get(inscription.classeId) ?? { absences: 0, retards: 0, justifiees: 0 },
        moyenneClasse,
        periodes: buildPeriodes(annee, inscription.classe.niveau?.cycle?.code ?? '', inscription.classeId),
        bareme: ['MATERNELLE', 'PRIMAIRE', 'COLLEGE', 'CRECHE'].includes((inscription.classe.niveau?.cycle?.code ?? '').toUpperCase()) ? 10 : 20,
        bulletins: classeBulletins.map((bulletin) => ({
          id: bulletin.id,
          trimestre: bulletin.trimestre,
          anneeScolaire: bulletin.anneeScolaire,
          moyenne: bulletin.moyenne,
          moyenneClasse: bulletin.moyenneClasse,
          rang: bulletin.rang,
          totalEleves: bulletin.totalEleves,
          appreciation: bulletin.appreciation,
          nombreAbsences: bulletin.nombreAbsences,
          nombreRetards: bulletin.nombreRetards,
          statut: bulletin.statut,
          fichierPdfUrl: bulletin.fichierPdfUrl,
        })),
      };
    });

    const validBulletins = bulletins.filter((bulletin) => typeof bulletin.moyenne === 'number');
    const firstMoyenne = validBulletins[0]?.moyenne ?? null;
    const lastMoyenne = validBulletins[validBulletins.length - 1]?.moyenne ?? null;
    const delta = firstMoyenne !== null && lastMoyenne !== null
      ? Math.round((lastMoyenne - firstMoyenne) * 100) / 100
      : null;
    const totalAbsences = absences.filter((absence) => absence.typeAbsence !== 'RETARD').length;
    const totalRetards = absences.filter((absence) => absence.typeAbsence === 'RETARD').length;
    const appreciationText = bulletins.map((bulletin) => bulletin.appreciation ?? '').join(' ').toLowerCase();
    const negativeBehavior = ['mauvais', 'insuffisant', 'indiscipline', 'retard', 'absent'].some((word) =>
      appreciationText.includes(word),
    );
    const bonComportement = totalAbsences <= 3 && totalRetards <= 3 && !negativeBehavior;

    return {
      eleve,
      parcours,
      statistiques: {
        nombreClasses: parcours.length,
        nombreBulletins: bulletins.length,
        moyenneGenerale: validBulletins.length
          ? Math.round((validBulletins.reduce((sum, bulletin) => sum + (bulletin.moyenne ?? 0), 0) / validBulletins.length) * 100) / 100
          : null,
        moyenneNotes: allNotes.length ? Math.round((allNotes.reduce((s, n) => s + (n.note ?? 0), 0) / allNotes.length) * 100) / 100 : null,
        nombreNotes: allNotes.length,
        totalAbsences,
        totalRetards,
        evolution:
          delta === null ? 'DONNEES_INSUFFISANTES' :
          delta > 0.5 ? 'PROGRES' :
          delta < -0.5 ? 'REGRESSION' :
          'STABLE',
        evolutionDelta: delta,
        comportement: bonComportement ? 'BON_COMPORTEMENT' : 'A_SURVEILLER',
        commentaireComportement: bonComportement
          ? 'Eleve de bon comportement selon les absences, retards et appréciations disponibles.'
          : 'Comportement à surveiller selon les absences, retards ou appréciations disponibles.',
      },
    };
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

  private async buildWhere(config: CrudConfig, tenantId: string | undefined, query: QueryParams): Promise<Payload> {
    const where = this.fixedWhere(config, tenantId);
    for (const [key, raw] of Object.entries(query)) {
      if (['page', 'size', 'sortBy', 'sort', 'asc', 'ascending', 'order', 'search', 'inscription'].includes(key)) continue;
      if (this.shouldSkipGenericFilter(config, key)) continue;
      const value = this.first(raw);
      const normalized = this.normalizeQueryValue(key, value);
      if (normalized !== undefined) where[key] = normalized;
    }

    const search = this.first(query.search)?.trim();
    if (search && config.model === 'user') {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { telephone: { contains: search, mode: 'insensitive' } },
        { adresse: { contains: search, mode: 'insensitive' } },
        { profession: { contains: search, mode: 'insensitive' } },
        { lieuTravail: { contains: search, mode: 'insensitive' } },
        { telephoneTravail: { contains: search, mode: 'insensitive' } },
      ];
    }
    await this.applyModelSpecificFilters(where, config, tenantId, query);
    return where;
  }

  private normalizeQueryValue(key: string, value: string | undefined) {
    if (value === undefined || value === '') return undefined;
    if (['actif', 'active', 'estCourante', 'publie', 'valide', 'visible'].includes(key)) {
      if (value === 'true') return true;
      if (value === 'false') return false;
    }
    return value;
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
    if (config.model === 'appel') {
      return [{ dateCours: 'desc' }, { heureDebut: 'desc' }, { createdAt: 'desc' }];
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
      const phoneCountry = await this.resolveTenantPhoneCountry(tenantId ?? String(data.tenantId ?? ''));
      for (const field of ['telephone', 'numeroUrgence', 'telephoneTravail']) {
        if (data[field] !== undefined) {
          data[field] = normalizePhoneForCountry(data[field], phoneCountry) ?? null;
        }
      }
      if (data.numeroIdentificationNational !== undefined) {
        const nin = String(data.numeroIdentificationNational ?? '').trim();
        if (!nin) {
          delete data.numeroIdentificationNational;
        } else if (!/^\d{10}$/.test(nin)) {
          throw new BadRequestException('numeroIdentificationNational invalide: 10 chiffres attendus');
        } else {
          data.numeroIdentificationNational = nin;
        }
      }

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
        if (data.role === 'ELEVE') {
          data.matricule = await this.generateMatricule(tenantId ?? String(data.tenantId ?? ''), 'ELV');
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
      delete data.ignoreImpayes;
      delete data.utilisateurId;
      delete data.sectionId;
      delete data.niveauId;
      delete data.frais;
      delete data.classeFrais;
      delete data.suggestion;
      delete data.demandePassage;
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

    if (config.model === 'absenceEleve') {
      await this.normalizeAbsenceEleveData(tenantId ?? String(data.tenantId ?? ''), data, create);
      if (create) data.statut ??= 'EN_ATTENTE';
    }

    if (config.model === 'convocation' && create) data.statut ??= 'EN_ATTENTE';
    if (config.model === 'appel' && create) data.statut ??= 'BROUILLON';
    if (config.model === 'absencePersonnel' && create) data.statut ??= 'EN_ATTENTE';
    if (config.model === 'pointage' && create) data.createdBy ??= userId;

    if (config.model === 'convocation') {
      await this.normalizeConvocationData(tenantId ?? String(data.tenantId ?? ''), data, create, userId);
    }

    if (config.model === 'annonce') {
      this.normalizeAnnonceData(data, create);
    }

    if (config.model === 'pointage') {
      this.normalizePointageData(data, create);
    }

    if (config.model === 'classe') {
      await this.normalizeClasseData(tenantId ?? String(data.tenantId ?? ''), data);
    }

    if (config.model === 'cours') {
      await this.normalizeCoursData(tenantId ?? String(data.tenantId ?? ''), data, create);
    }

    if (config.model === 'salle') {
      this.normalizeSalleData(data);
    }

    if (config.model === 'absencePersonnel') {
      this.normalizeAbsencePersonnelData(data);
    }

    if (config.model === 'personnel') {
      await this.normalizePersonnelData(tenantId ?? String(data.tenantId ?? ''), data, create);
    }

    this.validateModelUuids(config.model, data);

    return this.stripUndefined(data);
  }

  private async sendTeacherCredentials(tenantId: string | undefined, user: Payload, tempPassword: string): Promise<void> {
    await this.sendUserCredentials(tenantId, user, tempPassword, 'professeur');
  }

  private async sendStudentCredentials(tenantId: string | undefined, user: Payload, tempPassword: string): Promise<void> {
    await this.sendUserCredentials(tenantId, user, tempPassword, 'élève');
  }

  private async sendPersonnelCredentials(
    tenantId: string | undefined,
    utilisateurId: string,
    tempPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: utilisateurId } });
    if (!user) return;
    await this.sendUserCredentials(tenantId, user as unknown as Payload, tempPassword, 'personnel');
  }

  private async sendUserCredentials(
    tenantId: string | undefined,
    user: Payload,
    tempPassword: string,
    explicitAudience?: string,
  ): Promise<void> {
    const firstName = String(user.firstName ?? '');
    const lastName = String(user.lastName ?? '');
    const telephone = String(user.telephone ?? '').trim();
    const email = String(user.email ?? '').trim();
    const audience = explicitAudience ?? this.roleCredentialAudience(String(user.role ?? ''));
    const loginIdentifier = this.buildPreferredLoginIdentifier(user);
    const message = [
      `NouraSchool - Accès ${audience}`,
      `Identifiant: ${loginIdentifier}`,
      `Mot de passe provisoire: ${tempPassword}`,
      'Vous devrez modifier ce mot de passe lors de votre première connexion.',
    ].join('\n');

    if (tenantId && telephone) {
      this.whatsappService.sendMessage(tenantId, telephone, message).catch((error: unknown) => {
        this.logger.warn(`Identifiants ${audience} non envoyés par WhatsApp user=${String(user.id ?? '')}: ${this.formatError(error)}`);
      });
      return;
    }

    if (email) {
      const from = tenantId ? await this.resolveSchoolSender(tenantId) : undefined;
      this.mailService.sendCompteCree(email, firstName, lastName, tempPassword, from);
      this.logger.warn(`Fallback email utilisé pour les identifiants ${audience} user=${String(user.id ?? '')} faute de téléphone WhatsApp`);
      return;
    }

    this.logger.warn(`Identifiants ${audience} non envoyés: aucun téléphone WhatsApp ni email user=${String(user.id ?? '')}`);
  }

  private buildPreferredLoginIdentifier(user: Payload): string {
    const telephone = String(user.telephone ?? '').trim();
    const email = String(user.email ?? '').trim();
    const username = String(user.username ?? '').trim();
    const matricule = String(user.matricule ?? '').trim();
    return telephone || email || username || matricule || 'Votre numéro de téléphone';
  }

  private roleCredentialAudience(role: string): string {
    const normalized = role.trim().toUpperCase();
    const labels: Record<string, string> = {
      ADMIN: 'administrateur',
      ENSEIGNANT: 'professeur',
      ELEVE: 'élève',
      PARENT: 'parent',
      SURVEILLANT: 'surveillant',
      CAISSIER: 'caissier',
      RH: 'ressources humaines',
      GESTIONNAIRE: 'gestionnaire',
    };
    return labels[normalized] ?? 'utilisateur';
  }

  private sanitizeEntity(model: string, entity: Payload): Payload {
    if (!entity) return entity;
    if (model === 'user') {
      const { passwordHash: _passwordHash, eleveClasse, ...safeEntity } = entity as Payload & { passwordHash?: string; eleveClasse?: Payload };
      if (safeEntity.photoUrl) safeEntity.photoUrl = this.storage.resolveUrl(safeEntity.photoUrl as string) ?? undefined;
      if (eleveClasse && !safeEntity.classe) {
        safeEntity.classe = eleveClasse;
      }
      return safeEntity;
    }
    // Resolve photo URLs nested in personnel.utilisateur
    if (model === 'personnel' && entity.utilisateur) {
      const u = entity.utilisateur as Payload & { passwordHash?: string; photoUrl?: string };
      const { passwordHash: _ph, ...safeU } = u;
      if (safeU.photoUrl) safeU.photoUrl = this.storage.resolveUrl(safeU.photoUrl as string) ?? undefined;
      return { ...entity, utilisateur: safeU };
    }
    return entity;
  }

  private async attachEleveIfNeeded<T extends Payload>(model: string, rows: T[], tenantId?: string): Promise<T[]> {
    if (model === 'inscription') return this.attachInscriptionEleves(rows);
    if (model === 'bulletin' || model === 'absenceEleve' || model === 'reclamation') {
      return this.attachEleveById(rows);
    }
    if (model === 'cours') return this.attachEnseignantById(rows);
    if (model === 'pointage') return this.attachPointagePersonnel(rows);
    if (model === 'note') {
      const withEleves = await this.attachEleveById(rows);
      return tenantId ? this.attachNoteCoefficients(tenantId, withEleves) : withEleves;
    }
    if (model === 'convocation') return this.attachEleveById(rows);
    return rows;
  }

  private async attachEnseignantById<T extends Payload>(rows: T[]): Promise<T[]> {
    const ids = [...new Set(rows.map((r) => String(r.enseignantId ?? '')).filter(Boolean))];
    if (ids.length === 0) return rows;
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    const map = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({ ...r, enseignant: map.get(String(r.enseignantId ?? '')) ?? null }));
  }

  private async attachNoteCoefficients<T extends Payload>(tenantId: string, rows: T[]): Promise<T[]> {
    const cache = new Map<string, Map<string, number>>();
    const eleveIds = [...new Set(rows.map((row) => String(row.eleveId ?? '')).filter(Boolean))];
    const inscriptions = eleveIds.length
      ? await this.prisma.inscription.findMany({
          where: { tenantId, eleveId: { in: eleveIds } },
          include: {
            classe: { select: { id: true, nom: true } },
            anneeAcademique: { select: { libelle: true } },
          },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    const inscriptionByEleveYear = new Map<string, (typeof inscriptions)[number]>();
    const latestInscriptionByEleve = new Map<string, (typeof inscriptions)[number]>();
    for (const inscription of inscriptions) {
      if (!latestInscriptionByEleve.has(inscription.eleveId)) {
        latestInscriptionByEleve.set(inscription.eleveId, inscription);
      }
      const yearLabel = inscription.anneeAcademique?.libelle;
      if (yearLabel && !inscriptionByEleveYear.has(`${inscription.eleveId}:${yearLabel}`)) {
        inscriptionByEleveYear.set(`${inscription.eleveId}:${yearLabel}`, inscription);
      }
    }

    const getCoefficients = async (eleveId: string, anneeScolaire: string): Promise<Map<string, number>> => {
      const key = `${eleveId}|${anneeScolaire}`;
      const cached = cache.get(key);
      if (cached) return cached;
      const map = await this.findStudentCourseCoefficients(tenantId, eleveId, anneeScolaire);
      cache.set(key, map);
      return map;
    };

    return Promise.all(rows.map(async (row) => {
      const eleveId = String(row.eleveId ?? '');
      const anneeScolaire = String(row.anneeScolaire ?? '');
      if (!eleveId || !anneeScolaire) return row;
      const coefficients = await getCoefficients(eleveId, anneeScolaire);
      const inscription =
        inscriptionByEleveYear.get(`${eleveId}:${anneeScolaire}`) ??
        latestInscriptionByEleve.get(eleveId);
      return {
        ...row,
        coefficient: row.coefficient ?? coefficients.get(String(row.matiereId ?? '')) ?? 1,
        classeId: row.classeId ?? inscription?.classeId ?? null,
        classe:
          row.classe ??
          (inscription?.classe
            ? {
                id: inscription.classe.id,
                nom: inscription.classe.nom,
              }
            : null),
      };
    }));
  }

  private shouldSkipGenericFilter(config: CrudConfig, key: string): boolean {
    if (['from', 'to', 'dateFrom', 'dateTo'].includes(key)) return true;

    if (config.model === 'absenceEleve' && ['type', 'niveauId'].includes(key)) return true;
    if (config.model === 'note' && ['type', 'typeEval', 'periode', 'classeId', 'niveauId'].includes(key)) return true;
    if (config.model === 'reclamation' && ['type', 'priorite'].includes(key)) return true;
    if (config.model === 'paiement' && ['classeId', 'niveauId', 'eleveId', 'dateFrom', 'dateTo'].includes(key)) return true;

    return false;
  }

  private async applyModelSpecificFilters(
    where: Payload,
    config: CrudConfig,
    tenantId: string | undefined,
    query: QueryParams,
  ): Promise<void> {
    const from = this.first(query.from) ?? this.first(query.dateFrom);
    const to = this.first(query.to) ?? this.first(query.dateTo);

    switch (config.model) {
      case 'absenceEleve': {
        const type = this.first(query.type) ?? this.first(query.typeAbsence);
        if (type) where.typeAbsence = this.normalizeAbsenceType(type);
        const niveauId = this.first(query.niveauId);
        if (niveauId) {
          where.classe = { ...(((where.classe as Payload | undefined) ?? {})), niveauId };
        }
        this.applyDateRangeFilter(where, 'date', from, to);
        break;
      }
      case 'note': {
        const type =
          this.first(query.typeEvaluation) ??
          this.first(query.typeEval) ??
          this.first(query.type);
        const trimestre = this.first(query.trimestre) ?? this.first(query.periode);
        if (type) where.typeEvaluation = this.normalizeEvaluationType(type);
        if (trimestre && !where.trimestre) where.trimestre = trimestre;
        this.applyDateRangeFilter(where, 'dateEvaluation', from, to);
        await this.applyNoteScopeFilters(where, tenantId, query);
        break;
      }
      case 'reclamation': {
        this.applyDateRangeFilter(where, 'createdAt', from, to);
        break;
      }
      case 'paiement': {
        this.applyDateRangeFilter(where, 'datePaiement', from, to);
        const inscriptionScope: Payload = {};
        const classeId = this.first(query.classeId);
        const niveauId = this.first(query.niveauId);
        const eleveId = this.first(query.eleveId);
        if (classeId) inscriptionScope.classeId = classeId;
        if (eleveId) inscriptionScope.eleveId = eleveId;
        if (niveauId) inscriptionScope.classe = { niveauId };
        if (Object.keys(inscriptionScope).length > 0) {
          where.inscription = {
            ...((where.inscription as Payload | undefined) ?? {}),
            ...inscriptionScope,
          };
        }
        break;
      }
      case 'appel': {
        this.applyDateRangeFilter(where, 'dateCours', from, to);
        break;
      }
      default:
        break;
    }
  }

  private async applyNoteScopeFilters(where: Payload, tenantId: string | undefined, query: QueryParams): Promise<void> {
    const classeId = this.first(query.classeId);
    const niveauId = this.first(query.niveauId);
    if (!classeId && !niveauId) return;
    const scopedTenantId = this.assertUuid(tenantId, 'tenantId');

    const inscriptions = await this.prisma.inscription.findMany({
      where: {
        tenantId: scopedTenantId,
        statut: 'ACTIF',
        ...(classeId ? { classeId } : {}),
        ...(niveauId ? { classe: { niveauId } } : {}),
      },
      include: { anneeAcademique: { select: { libelle: true } } },
    });

    const eleveIds = [...new Set(inscriptions.map((inscription) => inscription.eleveId))];
    const existingEleveId = typeof where.eleveId === 'string' ? String(where.eleveId) : null;

    if (existingEleveId) {
      where.eleveId = eleveIds.includes(existingEleveId)
        ? existingEleveId
        : { in: ['00000000-0000-0000-0000-000000000000'] };
    } else {
      where.eleveId = { in: eleveIds.length ? eleveIds : ['00000000-0000-0000-0000-000000000000'] };
    }

    if (!where.anneeScolaire) {
      const yearLabels = [...new Set(inscriptions.map((inscription) => inscription.anneeAcademique?.libelle).filter(Boolean))];
      if (yearLabels.length === 1) {
        where.anneeScolaire = yearLabels[0];
      }
    }
  }

  private applyDateRangeFilter(where: Payload, field: string, from?: string, to?: string): void {
    if (!from && !to) return;
    const range: Payload = {};
    if (from) {
      const start = new Date(from);
      if (!Number.isNaN(start.getTime())) range.gte = start;
    }
    if (to) {
      const end = new Date(to);
      if (!Number.isNaN(end.getTime())) {
        end.setHours(23, 59, 59, 999);
        range.lte = end;
      }
    }
    if (Object.keys(range).length > 0) {
      where[field] = range;
    }
  }

  private normalizeAbsenceType(value: string): string {
    const normalized = String(value ?? '').trim().toUpperCase();
    return normalized === 'ABSENCE' ? 'ABSENT' : normalized || 'ABSENT';
  }

  private normalizeEvaluationType(value: string): string {
    return String(value ?? '').trim().toUpperCase() || 'DEVOIR';
  }

  private async resolveTenantPhoneCountry(tenantId: string): Promise<string> {
    if (!tenantId || !this.isUuidLike(tenantId)) return 'SN';
    const config = await this.prisma.ecoleConfig.findUnique({
      where: { tenantId },
      select: { pays: true },
    });
    return config?.pays ?? 'SN';
  }

  private async attachEleveById<T extends Payload>(rows: T[]): Promise<T[]> {
    const ids = [...new Set(rows.map((r) => String(r.eleveId ?? '')).filter(Boolean))];
    if (ids.length === 0) return rows;
    const eleves = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true, matricule: true, email: true },
    });
    const map = new Map(eleves.map((e) => [e.id, e]));
    return rows.map((r) => ({ ...r, eleve: map.get(String(r.eleveId ?? '')) ?? null }));
  }

  private async attachInscriptionEleves<T extends Payload>(inscriptions: T[]): Promise<T[]> {
    const eleveIds = [...new Set(inscriptions.map((inscription) => String(inscription.eleveId ?? '')).filter(Boolean))];
    if (eleveIds.length === 0) return inscriptions;

    const eleves = await this.prisma.user.findMany({
      where: { id: { in: eleveIds } },
      select: { id: true, firstName: true, lastName: true, matricule: true },
    });
    const elevesById = new Map(eleves.map((eleve) => [eleve.id, eleve]));

    return inscriptions.map((inscription) => ({
      ...inscription,
      eleve: elevesById.get(String(inscription.eleveId ?? '')) ?? null,
    }));
  }

  private async attachPointagePersonnel<T extends Payload>(rows: T[]): Promise<T[]> {
    const personnelIds = [...new Set(rows.map((row) => String(row.personnelId ?? '')).filter(Boolean))];
    if (personnelIds.length === 0) return rows;

    const personnels = await this.prisma.personnel.findMany({
      where: { id: { in: personnelIds } },
      include: {
        utilisateur: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            telephone: true,
            specialite: true,
          },
        },
      },
    });
    const map = new Map(personnels.map((personnel) => [personnel.id, personnel]));
    return rows.map((row) => ({ ...row, personnel: map.get(String(row.personnelId ?? '')) ?? null }));
  }

  private async resolveSchoolSender(tenantId: string): Promise<string | undefined> {
    if (process.env.RESEND_ALLOW_TENANT_FROM !== 'true') {
      return undefined;
    }

    const [config, tenant] = await Promise.all([
      this.prisma.ecoleConfig.findUnique({ where: { tenantId }, select: { nom: true } }),
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { nom: true, slug: true } }),
    ]);

    const schoolName = config?.nom || tenant?.nom || 'Noura School';
    const localDomain = tenant?.slug || this.schoolDomainName(schoolName);
    return `${schoolName} <contact@${localDomain}.assanediallo.com>`;
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
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
      cours: [...common, 'matiereId', 'classeId', 'enseignantId', 'anneeAcademiqueId'],
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

  private async normalizeCoursData(tenantId: string, data: Payload, create = false): Promise<void> {
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
      data.volumeHoraireHebdo = data.heures;
    }

    // Coercition numérique (le front peut envoyer des chaînes)
    if (data.volumeHoraireHebdo !== undefined && data.volumeHoraireHebdo !== null && data.volumeHoraireHebdo !== '') {
      const vol = Number(data.volumeHoraireHebdo);
      data.volumeHoraireHebdo = Number.isNaN(vol) ? null : Math.trunc(vol);
    } else if (data.volumeHoraireHebdo === '' || data.volumeHoraireHebdo === undefined) {
      if (create) data.volumeHoraireHebdo = null;
    }

    if (data.coefficient !== undefined && data.coefficient !== null && data.coefficient !== '') {
      const coef = Number(data.coefficient);
      data.coefficient = Number.isNaN(coef) ? null : coef;
    } else if (data.coefficient === '') {
      data.coefficient = null;
    }

    // Enseignant : champ obligatoire du modèle Cours
    const rawEnseignant = data.enseignantId ?? data.enseignant ?? data.professeurId;
    if (rawEnseignant !== undefined && rawEnseignant !== null && String(rawEnseignant).trim() !== '') {
      const enseignantId = this.assertUuid(String(rawEnseignant).trim(), 'enseignantId');
      const enseignant = await this.prisma.user.findFirst({
        where: { id: enseignantId, tenantId, role: 'ENSEIGNANT' },
        select: { id: true },
      });
      if (!enseignant) {
        throw new BadRequestException('Enseignant introuvable pour cet établissement');
      }
      data.enseignantId = enseignantId;
    } else if (create) {
      throw new BadRequestException('Veuillez sélectionner un enseignant pour ce cours');
    } else {
      delete data.enseignantId;
    }

    // Année académique : rattacher à l'année courante par défaut
    if (create && !data.anneeAcademiqueId) {
      data.anneeAcademiqueId = (await this.ensureCurrentAcademicYear(tenantId)).id;
    }

    // `description` n'existe pas sur le modèle Cours -> on l'écarte toujours
    delete data.description;
    delete data.enseignant;
    delete data.professeurId;
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
    // Normaliser vers l'énumération TypeAbsencePersonnel (MALADIE|CONGE|SANS_SOLDE|AUTRE)
    if (data.typeAbsence !== undefined && data.typeAbsence !== null && data.typeAbsence !== '') {
      let t = String(data.typeAbsence).toUpperCase();
      if (t === 'CONGES') t = 'CONGE';
      const valid = new Set(['MALADIE', 'CONGE', 'SANS_SOLDE', 'AUTRE']);
      data.typeAbsence = valid.has(t) ? t : 'AUTRE';
    } else {
      delete data.typeAbsence;
    }
    // Champs absents du modèle AbsencePersonnel
    delete data.type;
    delete data.justificatifJoint;
  }

  private async normalizeAbsenceEleveData(tenantId: string, data: Payload, create: boolean): Promise<void> {
    if (data.type !== undefined && data.typeAbsence === undefined) {
      data.typeAbsence = String(data.type);
    }

    if (data.date && !(data.date instanceof Date)) {
      data.date = new Date(String(data.date));
    } else if (create && !data.date) {
      data.date = new Date();
    }

    if (data.typeAbsence !== undefined && data.typeAbsence !== null && data.typeAbsence !== '') {
      let typeAbsence = String(data.typeAbsence).trim().toUpperCase();
      if (typeAbsence === 'ABSENCE') typeAbsence = 'ABSENT';
      const valid = new Set(['ABSENT', 'RETARD']);
      data.typeAbsence = valid.has(typeAbsence) ? typeAbsence : 'ABSENT';
    } else if (create) {
      data.typeAbsence = 'ABSENT';
    } else {
      delete data.typeAbsence;
    }

    if (!data.classeId && data.eleveId) {
      const eleve = await this.prisma.user.findFirst({
        where: { id: String(data.eleveId), tenantId, role: 'ELEVE' },
        select: { classeId: true },
      });
      data.classeId = eleve?.classeId;
    }

    if (create && !data.classeId) {
      throw new BadRequestException("Impossible d'enregistrer l'absence: aucun rattachement de classe trouvé pour cet élève.");
    }

    if (data.justifiee !== undefined) data.justifiee = Boolean(data.justifiee);
    else if (create) data.justifiee = false;

    if (data.motif === '') data.motif = null;

    delete data.type;
  }

  private async normalizeConvocationData(
    tenantId: string,
    data: Payload,
    create: boolean,
    userId?: string,
  ): Promise<void> {
    // parentId est requis : le dériver depuis l'élève s'il n'est pas fourni
    if (!data.parentId && data.eleveId) {
      const eleveId = this.assertUuid(String(data.eleveId), 'eleveId');
      const lien = await this.prisma.eleveParent.findFirst({
        where: { eleveId },
        select: { parentId: true },
      });
      if (lien?.parentId) data.parentId = lien.parentId;
    }
    if (create && !data.parentId) {
      throw new BadRequestException(
        "Cet élève n'a aucun parent rattaché — impossible de créer la convocation.",
      );
    }
    if (create && !data.dateConvocation) {
      data.dateConvocation = new Date();
    }
    if (!data.creePar && userId) data.creePar = userId;
    // Champs absents du modèle Convocation
    delete data.type;
    delete data.observations;
  }

  private normalizeAnnonceData(data: Payload, create: boolean): void {
    if (create && !data.dateDebut) data.dateDebut = new Date();
    if (data.dateFin === '' || data.dateFin === undefined) {
      if (create) data.dateFin = null;
    }
    if (data.actif !== undefined) data.actif = Boolean(data.actif);
    // Champs hérités d'anciennes versions, absents du modèle Annonce
    delete data.type;
    delete data.cible;
    delete data.statut;
    delete data.priorite;
  }

  private normalizePointageData(data: Payload, create: boolean): void {
    if (data.statut !== undefined && data.statut !== null && data.statut !== '') {
      data.statut = String(data.statut).toUpperCase();
    } else if (data.statut === '') {
      data.statut = null;
    }

    // Jour de pointage (colonne `date`)
    if (data.date && !(data.date instanceof Date)) {
      const d = new Date(String(data.date));
      data.date = Number.isNaN(d.getTime()) ? null : d;
    }

    // Horodatage principal `dateHeure` : jour + heure d'arrivée si disponible, sinon maintenant
    if (!data.dateHeure) {
      const base = data.date instanceof Date ? new Date(data.date) : new Date();
      const hhmm = String(data.heureArrivee ?? data.heureDepart ?? '').trim();
      const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
      if (m) base.setHours(Number(m[1]), Number(m[2]), 0, 0);
      data.dateHeure = base;
    }

    // typePointage requis par l'énumération — valeur par défaut
    if (!data.typePointage) data.typePointage = 'ENTREE';

    if (data.heureArrivee === '') data.heureArrivee = null;
    if (data.heureDepart === '') data.heureDepart = null;
    if (data.observations === '') data.observations = null;
    if (create && data.date == null) data.date = new Date();
  }

  private async normalizePersonnelData(tenantId: string, data: Payload, create = false): Promise<void> {
    const fonction = String(data.specialite ?? data.fonction ?? data.type ?? '').trim();
    const affectationType = String(data.affectationType ?? '').trim().toUpperCase();
    const niveauId = data.niveauId ? this.assertUuid(data.niveauId, 'niveauId') : undefined;
    const sectionId = data.sectionId ? this.assertUuid(data.sectionId, 'sectionId') : undefined;
    const phoneCountry = await this.resolveTenantPhoneCountry(tenantId);
    const normalizedTelephone = normalizePhoneForCountry(data.telephone, phoneCountry);

    if (affectationType === 'SURVEILLANT' || affectationType === 'SECRETAIRE_SURVEILLANT') {
      if (!sectionId) throw new BadRequestException('sectionId est requis pour ce personnel');
      const section = await this.prisma.cycle.findFirst({ where: { id: sectionId, tenantId } });
      if (!section) throw new BadRequestException('Section introuvable');
      data.__personnelSectionId = sectionId;
      data.__personnelAffectationType = affectationType;
    }

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
        if (!create) {
          const userUpdate: Record<string, unknown> = {};
          if (firstName) userUpdate['firstName'] = firstName;
          if (lastName) userUpdate['lastName'] = lastName;
          if (normalizedTelephone) userUpdate['telephone'] = normalizedTelephone;
          if (data.adresse) userUpdate['adresse'] = String(data.adresse);
          if (data.specialite) userUpdate['specialite'] = String(data.specialite);
          if (Object.keys(userUpdate).length > 0) {
            await this.prisma.user.update({ where: { id: existingUser.id }, data: userUpdate });
          }
        }
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
            telephone: normalizedTelephone ?? undefined,
            adresse: data.adresse ? String(data.adresse) : undefined,
            role,
            actif: true,
            mustChangePwd: true,
            specialite: data.specialite ? String(data.specialite) : undefined,
          },
        });
        data.utilisateurId = createdUser.id;
        if (this.shouldNotifyPersonnelCredentials(fonction)) {
          data.__tempPasswordForNotification = generatedPassword;
        }
      }
    }

    if (create) {
      const year = new Date().getFullYear();
      const count = await this.prisma.personnel.count({ where: { tenantId } });
      data.numeroMatricule = `PERS-${year}-${String(count + 1).padStart(4, '0')}`;
    }

    if (data.typeContrat === 'CDD') {
      const dureeMois = Number(data.dureeMois);
      if (!Number.isNaN(dureeMois) && dureeMois > 0) {
        const debut = data.dateEmbauche ? new Date(data.dateEmbauche as string | Date) : new Date();
        debut.setMonth(debut.getMonth() + dureeMois);
        data.dureeMois = dureeMois;
        data.dateFinContrat = debut;
      } else {
        throw new BadRequestException('dureeMois est requis pour un contrat CDD');
      }
    } else if (data.typeContrat !== undefined) {
      data.dureeMois = null;
      data.dateFinContrat = null;
    }

    if (data.salaire !== undefined) {
      const salaire = Number(data.salaire);
      data.salaire = Number.isNaN(salaire) ? undefined : salaire;
    }

    delete data.soldeConge;
    delete data.prenom;
    delete data.nom;
    delete data.firstName;
    delete data.lastName;
    delete data.email;
    delete data.telephone;
    delete data.adresse;
    delete data.type;
    delete data.fonction;
    delete data.niveauId;
    delete data.sectionId;
    delete data.affectationType;
    delete data.ordreHierarchique;
    delete data.specialite;
    delete data.cycleId;
    delete data.matieres;
  }

  private async replaceSurveillantForCycle(tenantId: string, cycleId: string, newSurveillantId: string): Promise<void> {
    const existing = await this.prisma.surveillantCycle.findFirst({ where: { cycleId } });
    if (existing && existing.surveillantId !== newSurveillantId) {
      await this.prisma.user.update({ where: { id: existing.surveillantId }, data: { actif: false } });
      await this.prisma.surveillantCycle.deleteMany({ where: { cycleId } });
    }
    await this.prisma.surveillantCycle.upsert({
      where: { surveillantId_cycleId: { surveillantId: newSurveillantId, cycleId } },
      create: { tenantId, surveillantId: newSurveillantId, cycleId },
      update: {},
    });
  }

  private normalizePersonnelRole(value: unknown): 'ENSEIGNANT' | 'SURVEILLANT' | 'CAISSIER' | 'RH' {
    const role = String(value ?? '').trim().toUpperCase();
    if (role === 'ENSEIGNANT') return 'ENSEIGNANT';
    if (role === 'SURVEILLANT') return 'SURVEILLANT';
    if (role === 'CAISSIER') return 'CAISSIER';
    return 'RH';
  }

  private shouldNotifyPersonnelCredentials(value: string): boolean {
    const normalized = value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z]+/g, '_');
    return [
      'SURVEILLANT',
      'SECRETAIRE',
      'SECRETAIRE_SURVEILLANT',
      'BIBLIOTHECAIRE',
      'COMPTABLE',
    ].some((key) => normalized.includes(key));
  }

  private toPositiveInt(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) return fallback;
    return parsed;
  }

  private async createPersonnelNiveauAffectation(
    tenantId: string,
    personnelId: string,
    niveauId: string,
    type: string,
    ordre: number,
  ): Promise<void> {
    if (type === 'SURVEILLANT') {
      const existing = await this.prisma.personnelNiveauAffectation.findFirst({
        where: { tenantId, niveauId, type: 'SURVEILLANT' },
        include: { personnel: { include: { utilisateur: true } } },
      });
      if (existing) {
        const user = existing.personnel.utilisateur;
        throw new BadRequestException(`Ce niveau a déjà un surveillant: ${user.firstName} ${user.lastName}`);
      }
    }

    if (type === 'SECRETAIRE_SURVEILLANT') {
      const existingOrder = await this.prisma.personnelNiveauAffectation.findFirst({
        where: { tenantId, niveauId, type, ordre },
      });
      if (existingOrder) {
        throw new BadRequestException('Cet ordre hiérarchique est déjà utilisé pour ce niveau');
      }
    }

    await this.prisma.personnelNiveauAffectation.create({
      data: { tenantId, personnelId, niveauId, type, ordre },
    });
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
    delete data.coefficient;
    delete data.classeId;
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

  private async clearEleveClasseIfCurrent(eleveId?: string, classeId?: string): Promise<void> {
    if (!eleveId || !classeId) return;
    await this.prisma.user.updateMany({
      where: { id: eleveId, role: 'ELEVE', classeId },
      data: { classeId: null },
    });
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
      const suffix = `${Date.now().toString(36).toUpperCase()}${index ? index.toString().padStart(2, '00') : ''}`;
      const matricule = `${prefix}-${year}-${suffix}`;
      const existing = await this.prisma.user.findFirst({ where: { tenantId, matricule } });
      if (!existing) return matricule;
    }
    return `${prefix}-${year}-${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  private generateInscriptionNumero(tenantId: string): string {
    const ts = Date.now().toString(36).toUpperCase();
    const rand = randomBytes(2).toString('hex').toUpperCase();
    return `INS-${tenantId.slice(0, 4).toUpperCase()}-${ts}${rand}`;
  }

  private async assertNoImpayes(tenantId: string | undefined, eleveId: string): Promise<void> {
    if (!tenantId || !eleveId) return;
    const anneeCourante = await this.findCurrentAnnee(tenantId);
    const impayes = await this.prisma.paiement.findMany({
      where: {
        tenantId,
        eleveId,
        statut: 'EN_ATTENTE',
        ...(anneeCourante ? { anneeScolaire: { not: anneeCourante.libelle } } : {}),
      },
      select: { id: true, montant: true, typePaiement: true, anneeScolaire: true },
    });
    if (impayes.length > 0) {
      const total = impayes.reduce((sum, p) => sum + p.montant, 0);
      throw new BadRequestException(`IMPAYES_PRECEDENTS:${total}:${impayes.length}`);
    }
  }

  private async assertSingleInscriptionPerYear(tenantId: string | undefined, data: Payload): Promise<void> {
    if (!tenantId) return;
    const eleveId = String(data.eleveId ?? '');
    const classeId = String(data.classeId ?? '');
    const anneeAcademiqueId = String(data.anneeAcademiqueId ?? '');
    if (!eleveId || !classeId || !anneeAcademiqueId) return;

    const [existing, classe] = await Promise.all([
      this.prisma.inscription.findFirst({
        where: { tenantId, eleveId, anneeAcademiqueId },
        select: { id: true },
      }),
      this.prisma.classe.findFirst({
        where: { tenantId, id: classeId },
        select: { anneeAcademiqueId: true },
      }),
    ]);

    if (existing) {
      throw new BadRequestException('INSCRIPTION_DEJA_EXISTANTE: cet élève est déjà inscrit pour cette année scolaire');
    }

    if (!classe) {
      throw new BadRequestException('CLASSE_INTROUVABLE');
    }

    if (classe.anneeAcademiqueId !== anneeAcademiqueId) {
      throw new BadRequestException('CLASSE_ANNEE_INVALIDE: la classe ne correspond pas à l’année scolaire choisie');
    }
  }

  private async assertInscriptionClassAllowed(tenantId: string | undefined, data: Record<string, any>, user?: JwtUser): Promise<void> {
    if (!tenantId || !user) return;
    const unrestrictedRoles = new Set(['ADMIN', 'GESTIONNAIRE', 'SUPER_ADMIN']);
    if (unrestrictedRoles.has(user.role)) return;
    if (user.role !== 'CAISSIER') return;

    const eleveId = String(data.eleveId ?? '');
    const classeId = String(data.classeId ?? '');
    if (!eleveId || !classeId) return;

    const suggestion = await this.getInscriptionSuggestion(tenantId, eleveId);
    if (!suggestion.lastInscription) return;
    if (!suggestion.peutPasser) {
      throw new BadRequestException('DEMANDE_PASSAGE_REQUISE: moyenne insuffisante');
    }

    const allowedIds = new Set((suggestion.classesDisponibles ?? []).map((classe: { id: string }) => classe.id));
    if (!allowedIds.has(classeId)) {
      throw new BadRequestException('CLASSE_NON_AUTORISEE: seul le niveau suivant est autorisé pour cet élève');
    }
  }

  async getInscriptionSuggestion(tenantId: string | undefined, eleveId: string) {
    if (!tenantId) throw new NotFoundException('Tenant introuvable');
    const anneeCourante = await this.findCurrentAnnee(tenantId);

    const lastInscription = await this.prisma.inscription.findFirst({
      where: { tenantId, eleveId },
      orderBy: { createdAt: 'desc' },
      include: {
        classe: { include: { niveau: { include: { cycle: true } } } },
        anneeAcademique: { select: { id: true, libelle: true } },
      },
    });

    if (!lastInscription?.classe?.niveau) {
      return { lastInscription: null, moyenne: null, peutPasser: false, nextNiveau: null, classesDisponibles: [], frais: null, impayesCount: 0 };
    }

    const currentNiveau = lastInscription.classe.niveau;

    const bulletins = await this.prisma.bulletin.findMany({
      where: { tenantId, eleveId, anneeScolaire: lastInscription.anneeAcademique?.libelle ?? '' },
      select: { moyenne: true },
    });
    const moyennes = bulletins.map((b) => b.moyenne).filter((m): m is number => m != null);
    const moyenne = moyennes.length > 0 ? moyennes.reduce((s, v) => s + v, 0) / moyennes.length : null;

    const nextNiveau = await this.prisma.niveau.findFirst({
      where: { tenantId, cycleId: currentNiveau.cycleId, ordre: { gt: currentNiveau.ordre }, actif: true },
      orderBy: { ordre: 'asc' },
      include: { cycle: { select: { id: true, libelle: true } } },
    });

    const classesDisponibles = nextNiveau && anneeCourante
      ? await this.prisma.classe.findMany({
          where: { tenantId, niveauId: nextNiveau.id, anneeAcademiqueId: anneeCourante.id, actif: true },
          select: { id: true, nom: true, effectifMax: true },
        })
      : [];

    const frais = nextNiveau
      ? await this.prisma.fraisNiveauConfig.findFirst({
          where: { tenantId, section: currentNiveau.cycle.libelle, niveau: nextNiveau.libelle, actif: true },
          select: { inscription: true, mensualite: true, nbMois: true },
        })
      : null;

    const impayesCount = await this.prisma.paiement.count({
      where: {
        tenantId,
        eleveId,
        statut: 'EN_ATTENTE',
        ...(anneeCourante ? { anneeScolaire: { not: anneeCourante.libelle } } : {}),
      },
    });

    return {
      lastInscription: {
        id: lastInscription.id,
        classe: { id: lastInscription.classe.id, nom: lastInscription.classe.nom },
        niveau: {
          id: currentNiveau.id,
          code: currentNiveau.code,
          libelle: currentNiveau.libelle,
          ordre: currentNiveau.ordre,
          moyennePassage: currentNiveau.moyennePassage,
        },
        anneeAcademique: lastInscription.anneeAcademique,
      },
      moyenne,
      peutPasser: moyenne != null && nextNiveau != null && moyenne >= currentNiveau.moyennePassage,
      nextNiveau: nextNiveau
        ? { id: nextNiveau.id, code: nextNiveau.code, libelle: nextNiveau.libelle, ordre: nextNiveau.ordre }
        : null,
      classesDisponibles,
      frais,
      impayesCount,
    };
  }

  async createDemandePassage(tenantId: string | undefined, body: Payload, userId: string | undefined) {
    if (!tenantId) throw new NotFoundException('Tenant introuvable');
    if (!userId) throw new BadRequestException('Utilisateur requis');
    const eleveId = this.assertUuid(body.eleveId, 'eleveId');
    const classeDestId = this.assertUuid(body.classeDestId, 'classeDestId');
    const anneeCourante = await this.findCurrentAnnee(tenantId);
    if (!anneeCourante) throw new BadRequestException('Aucune année académique courante');

    return this.prisma.demandePassage.create({
      data: {
        tenantId,
        eleveId,
        classeDestId,
        anneeAcademiqueId: anneeCourante.id,
        motif: body.motif ? String(body.motif) : null,
        statut: 'EN_ATTENTE',
        creePar: userId,
      },
      include: this.demandePassageInclude(),
    });
  }

  async getDemandesPassage(tenantId: string | undefined, query: QueryParams) {
    if (!tenantId) throw new NotFoundException('Tenant introuvable');
    const where: Record<string, unknown> = { tenantId };
    if (query.statut) where.statut = query.statut;
    if (query.eleveId) where.eleveId = query.eleveId;
    if (query.anneeAcademiqueId) where.anneeAcademiqueId = query.anneeAcademiqueId;

    return this.prisma.demandePassage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: this.demandePassageInclude(),
    });
  }

  async approuverDemandePassage(tenantId: string | undefined, id: string, userId: string | undefined) {
    if (!tenantId) throw new NotFoundException('Tenant introuvable');
    const demande = await this.prisma.demandePassage.findFirst({ where: { id, tenantId } });
    if (!demande) throw new NotFoundException('Demande introuvable');
    if (demande.statut !== 'EN_ATTENTE') throw new BadRequestException('Cette demande a déjà été traitée');

    const anneeCourante = await this.findCurrentAnnee(tenantId);
    if (!anneeCourante) throw new BadRequestException('Aucune année académique courante');
    await this.assertSingleInscriptionPerYear(tenantId, {
      eleveId: demande.eleveId,
      classeId: demande.classeDestId,
      anneeAcademiqueId: anneeCourante.id,
    });

    const [updated] = await this.prisma.$transaction([
      this.prisma.demandePassage.update({
        where: { id },
        data: { statut: 'APPROUVEE', traitePar: userId ?? null },
        include: this.demandePassageInclude(),
      }),
      this.prisma.inscription.create({
        data: {
          tenantId,
          eleveId: demande.eleveId,
          classeId: demande.classeDestId,
          anneeAcademiqueId: anneeCourante.id,
          numeroInscription: this.generateInscriptionNumero(tenantId),
          statut: 'ACTIF',
          creePar: userId ?? demande.creePar,
        },
      }),
    ]);

    return updated;
  }

  async rejeterDemandePassage(tenantId: string | undefined, id: string, body: Payload, userId: string | undefined) {
    if (!tenantId) throw new NotFoundException('Tenant introuvable');
    const demande = await this.prisma.demandePassage.findFirst({ where: { id, tenantId } });
    if (!demande) throw new NotFoundException('Demande introuvable');
    if (demande.statut !== 'EN_ATTENTE') throw new BadRequestException('Cette demande a déjà été traitée');

    return this.prisma.demandePassage.update({
      where: { id },
      data: {
        statut: 'REJETEE',
        traitePar: userId ?? null,
        motifRefus: body.motifRefus ? String(body.motifRefus) : null,
      },
      include: this.demandePassageInclude(),
    });
  }

  private demandePassageInclude() {
    return {
      classeDest: {
        select: {
          id: true,
          nom: true,
          niveau: { select: { id: true, code: true, libelle: true } },
        },
      },
      anneeAcademique: { select: { id: true, libelle: true } },
      eleve: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          matricule: true,
          telephone: true,
          eleveClasse: { select: { id: true, nom: true } },
          elevParents: {
            select: {
              parent: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  telephone: true,
                  email: true,
                  lienParente: true,
                },
              },
            },
          },
        },
      },
    };
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
