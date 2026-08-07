import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '@/config/prisma.service';
import { StorageService } from '@/infrastructure/storage/storage.service';
import { MailService } from '@/infrastructure/mail/mail.service';
import { WhatsappService } from '@/modules/whatsapp/whatsapp.service';
import type { JwtUser } from '@/common/types/auth.types';
import { normalizePhoneForCountry } from '@/common/utils/phone.util';
import { mapWithConcurrency } from '@/common/utils/async.util';
import { calculateBulletinAverages } from '@/common/utils/bulletin-calculation.util';
import { AppCacheService } from '@/infrastructure/cache/app-cache.service';
import { BulletinDocumentService } from '@/modules/bulletin-document.service';
import { PushNotificationService } from '@/modules/push-notification.service';
import { buildDebtDashboardSummary, buildDebtSummary, DebtPaymentRow } from '@/modules/debt-summary.util';

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
  'matieres-niveaux': { model: 'matiereNiveau', tenantScoped: true, defaultOrderBy: { createdAt: 'asc' } },
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
  'matieres-niveaux': V1_RESOURCES['matieres-niveaux'],
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
    private readonly cache: AppCacheService,
    private readonly bulletinDocument: BulletinDocumentService,
    private readonly pushNotifications: PushNotificationService,
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
    } : config.model === 'user' && config.role === 'ENSEIGNANT' ? {
      matieresEnseignees: {
        select: {
          matiere: { select: { id: true, code: true, libelle: true } },
        },
      },
      coursEnseignant: {
        select: {
          id: true,
          matiere: { select: { id: true, code: true, libelle: true } },
          classe: { select: { id: true, nom: true } },
        },
      },
    } : config.model === 'classe' ? {
      cycle: true,
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
      enseignant: true,
      anneeAcademique: { select: { id: true, libelle: true, estCourante: true } }
    } : config.model === 'note' ? {
      matiere: { select: { id: true, code: true, libelle: true } },
    } : config.model === 'matiereNiveau' ? {
      matiere: { select: { id: true, code: true, libelle: true, categorie: true } },
      niveau: { select: { id: true, libelle: true } },
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
          photoUrl: true,
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
    } : config.model === 'matiere' ? {
      _count: { select: { cours: true, notes: true } },
      cours: {
        include: {
          classe: { select: { id: true, nom: true } },
          anneeAcademique: { select: { id: true, libelle: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
    } : config.model === 'bulletin' ? {
      classe: { select: { id: true, nom: true, anneeAcademiqueId: true } },
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
      content = await this.attachMatiereDependencyCounts(config.model, content, tenantId);
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
    rows = await this.attachMatiereDependencyCounts(config.model, rows, tenantId);
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
    } : config.model === 'user' && config.role === 'ENSEIGNANT' ? {
      matieresEnseignees: {
        select: {
          matiere: { select: { id: true, code: true, libelle: true } },
        },
      },
      coursEnseignant: {
        select: {
          id: true,
          matiere: { select: { id: true, code: true, libelle: true } },
          classe: { select: { id: true, nom: true } },
        },
      },
    } : config.model === 'classe' ? {
      cycle: true,
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
      enseignant: true,
      anneeAcademique: { select: { id: true, libelle: true, estCourante: true } }
    } : config.model === 'note' ? {
      matiere: { select: { id: true, code: true, libelle: true } },
    } : config.model === 'matiereNiveau' ? {
      matiere: { select: { id: true, code: true, libelle: true, categorie: true } },
      niveau: { select: { id: true, libelle: true } },
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
          photoUrl: true,
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
    } : config.model === 'matiere' ? {
      _count: { select: { cours: true, notes: true } },
      cours: {
        include: {
          classe: { select: { id: true, nom: true } },
          anneeAcademique: { select: { id: true, libelle: true } },
        },
        orderBy: { createdAt: 'desc' },
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
    let [hydrated] = await this.attachEleveIfNeeded(config.model, [entity], tenantId);
    [hydrated] = await this.attachMatiereDependencyCounts(config.model, [hydrated], tenantId);
    if (config.model === 'bulletin') {
      const bulletin = hydrated as Payload & { eleveId: string; trimestre: string; anneeScolaire: string; classeId: string; classe?: { anneeAcademiqueId?: string } };
      const [notes, affectations] = await Promise.all([
        this.prisma.note.findMany({
          where: { tenantId: String(bulletin.tenantId), eleveId: bulletin.eleveId, trimestre: bulletin.trimestre, anneeScolaire: bulletin.anneeScolaire },
          include: { matiere: { select: { id: true, code: true, libelle: true } } },
          orderBy: [{ dateEvaluation: 'asc' }, { createdAt: 'asc' }],
        }),
        this.prisma.matiereClasse.findMany({
          where: {
            tenantId: String(bulletin.tenantId),
            classeId: bulletin.classeId,
            anneeScolaire: bulletin.anneeScolaire,
            ...(bulletin.classe?.anneeAcademiqueId ? { anneeAcademiqueId: bulletin.classe.anneeAcademiqueId } : {}),
          },
          include: { enseignant: { select: { firstName: true, lastName: true } } },
        }),
      ]);
      const teachers = new Map(affectations.map((affectation) => [
        affectation.matiereId,
        `${affectation.enseignant.firstName} ${affectation.enseignant.lastName}`.trim() || '—',
      ]));
      return this.sanitizeEntity(config.model, {
        ...bulletin,
        notes: notes.map((note) => ({ ...note, enseignantNom: teachers.get(note.matiereId) ?? '—' })),
      });
    }
    return this.sanitizeEntity(config.model, hydrated);
  }

  async createMatiereWithAssignments(
    tenantId: string,
    body: {
      code?: unknown;
      libelle?: unknown;
      description?: unknown;
      actif?: unknown;
      affectations?: unknown;
    },
  ) {
    const code = String(body.code ?? '').trim().toUpperCase();
    const libelle = String(body.libelle ?? '').trim();
    const description = String(body.description ?? '').trim() || null;
    if (!code || !libelle) {
      throw new BadRequestException('Le code et le libellé de la matière sont obligatoires');
    }

    const existing = await this.prisma.matiere.findFirst({ where: { tenantId, code } });
    if (existing) throw new ConflictException('Une matière avec ce code existe déjà');

    const rawAssignments = Array.isArray(body.affectations) ? body.affectations : [];
    const assignments = rawAssignments.map((raw, index) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      const classeId = this.assertUuid(String(item.classeId ?? ''), `affectations[${index}].classeId`);
      const enseignantId = this.assertUuid(String(item.enseignantId ?? ''), `affectations[${index}].enseignantId`);
      const coefficient = Number(item.coefficient ?? 1);
      const volumeHoraireHebdo = item.volumeHoraireHebdo === null
        || item.volumeHoraireHebdo === undefined
        || item.volumeHoraireHebdo === ''
        ? null
        : Number(item.volumeHoraireHebdo);
      const montantHoraire = item.montantHoraire === null
        || item.montantHoraire === undefined
        || item.montantHoraire === ''
        ? null
        : Number(item.montantHoraire);

      if (!Number.isFinite(coefficient) || coefficient < 0.5) {
        throw new BadRequestException(`Coefficient invalide pour l'affectation ${index + 1}`);
      }
      if (volumeHoraireHebdo !== null && (!Number.isFinite(volumeHoraireHebdo) || volumeHoraireHebdo < 0)) {
        throw new BadRequestException(`Volume horaire invalide pour l'affectation ${index + 1}`);
      }
      if (montantHoraire !== null && (!Number.isFinite(montantHoraire) || montantHoraire < 0)) {
        throw new BadRequestException(`Montant horaire invalide pour l'affectation ${index + 1}`);
      }
      return { classeId, enseignantId, coefficient, volumeHoraireHebdo, montantHoraire };
    });

    const uniqueClasseIds = new Set(assignments.map((assignment) => assignment.classeId));
    if (uniqueClasseIds.size !== assignments.length) {
      throw new BadRequestException('Une classe ne peut être affectée qu’une seule fois à la même matière');
    }

    const [classes, enseignants] = await Promise.all([
      this.prisma.classe.findMany({
        where: { tenantId, id: { in: [...uniqueClasseIds] } },
        select: {
          id: true,
          anneeAcademiqueId: true,
          anneeAcademique: { select: { id: true, libelle: true } },
        },
      }),
      this.prisma.user.findMany({
        where: {
          tenantId,
          role: 'ENSEIGNANT',
          id: { in: [...new Set(assignments.map((assignment) => assignment.enseignantId))] },
        },
        select: { id: true },
      }),
    ]);
    if (classes.length !== uniqueClasseIds.size) {
      throw new BadRequestException('Une ou plusieurs classes sont introuvables pour cet établissement');
    }
    const teacherIds = new Set(enseignants.map((enseignant) => enseignant.id));
    if (assignments.some((assignment) => !teacherIds.has(assignment.enseignantId))) {
      throw new BadRequestException('Un ou plusieurs enseignants sont introuvables pour cet établissement');
    }
    const classById = new Map(classes.map((classe) => [classe.id, classe]));
    const fallbackAcademicYear = classes.some((classe) => !classe.anneeAcademiqueId)
      ? await this.ensureCurrentAcademicYear(tenantId)
      : null;

    const createdId = await this.prisma.$transaction(async (tx) => {
      const matiere = await tx.matiere.create({
        data: {
          tenantId,
          code,
          libelle,
          description,
          actif: body.actif !== false,
        },
      });

      const cours = await Promise.all(assignments.map((assignment) => {
        const classe = classById.get(assignment.classeId)!;
        const annee = classe.anneeAcademique ?? fallbackAcademicYear;
        if (!annee?.id) {
          throw new BadRequestException('Aucune année académique disponible pour affecter cette matière');
        }

        return tx.cours.create({
          data: {
            tenantId,
            matiereId: matiere.id,
            classeId: assignment.classeId,
            enseignantId: assignment.enseignantId,
            anneeAcademiqueId: annee.id,
            coefficient: assignment.coefficient,
            volumeHoraireHebdo: assignment.volumeHoraireHebdo,
            montantHoraire: assignment.montantHoraire,
          },
          include: {
            classe: { select: { id: true, nom: true } },
          },
        }).then(async (createdCours) => {
          await tx.matiereClasse.upsert({
            where: {
              matiereId_classeId_enseignantId_anneeAcademiqueId: {
                matiereId: matiere.id,
                classeId: assignment.classeId,
                enseignantId: assignment.enseignantId,
                anneeAcademiqueId: annee.id,
              },
            },
            update: {
              anneeScolaire: annee.libelle,
              volumeHoraire: assignment.volumeHoraireHebdo,
            },
            create: {
              tenantId,
              matiereId: matiere.id,
              classeId: assignment.classeId,
              enseignantId: assignment.enseignantId,
              anneeAcademiqueId: annee.id,
              anneeScolaire: annee.libelle,
              volumeHoraire: assignment.volumeHoraireHebdo,
            },
          });
          return createdCours;
        });
      }));

      await this.rebuildMatiereClasseForMatiere(tx, tenantId, matiere.id);
      return matiere.id;
    });

    return this.hydrateMatiereForAdmin(tenantId, createdId);
  }

  async updateMatiereWithAssignments(
    tenantId: string,
    id: string,
    body: {
      code?: unknown;
      libelle?: unknown;
      description?: unknown;
      actif?: unknown;
      affectations?: unknown;
    },
  ) {
    const matiereId = this.assertUuid(id, 'id');
    const existing = await this.prisma.matiere.findFirst({ where: { tenantId, id: matiereId } });
    if (!existing) throw new NotFoundException('Matière introuvable');

    const code = body.code !== undefined ? String(body.code ?? '').trim().toUpperCase() : existing.code;
    const libelle = body.libelle !== undefined ? String(body.libelle ?? '').trim() : existing.libelle;
    const description = body.description !== undefined ? String(body.description ?? '').trim() || null : existing.description;
    const actif = body.actif !== undefined ? body.actif !== false : existing.actif;
    if (!code || !libelle) {
      throw new BadRequestException('Le code et le libellé de la matière sont obligatoires');
    }

    if (code !== existing.code) {
      const duplicate = await this.prisma.matiere.findFirst({ where: { tenantId, code, id: { not: matiereId } } });
      if (duplicate) throw new ConflictException('Une matière avec ce code existe déjà');
    }

    const shouldSyncAssignments = Array.isArray(body.affectations);
    const assignments = shouldSyncAssignments
      ? (body.affectations as unknown[]).map((raw, index) => {
          const item = (raw ?? {}) as Record<string, unknown>;
          const coursId = item.id || item.coursId ? this.assertUuid(String(item.id ?? item.coursId), `affectations[${index}].id`) : null;
          const classeId = this.assertUuid(String(item.classeId ?? ''), `affectations[${index}].classeId`);
          const enseignantId = this.assertUuid(String(item.enseignantId ?? ''), `affectations[${index}].enseignantId`);
          const coefficient = Number(item.coefficient ?? 1);
          const volumeHoraireHebdo = item.volumeHoraireHebdo === null
            || item.volumeHoraireHebdo === undefined
            || item.volumeHoraireHebdo === ''
            ? null
            : Number(item.volumeHoraireHebdo);

          if (!Number.isFinite(coefficient) || coefficient < 0.5) {
            throw new BadRequestException(`Coefficient invalide pour l'affectation ${index + 1}`);
          }
          if (volumeHoraireHebdo !== null && (!Number.isFinite(volumeHoraireHebdo) || volumeHoraireHebdo < 0)) {
            throw new BadRequestException(`Volume horaire invalide pour l'affectation ${index + 1}`);
          }
          return { coursId, classeId, enseignantId, coefficient, volumeHoraireHebdo };
        })
      : [];

    if (shouldSyncAssignments) {
      const uniqueClasseIds = new Set(assignments.map((assignment) => assignment.classeId));
      if (uniqueClasseIds.size !== assignments.length) {
        throw new BadRequestException('Une classe ne peut être affectée qu’une seule fois à la même matière');
      }

      const [classes, enseignants] = await Promise.all([
        this.prisma.classe.findMany({
          where: { tenantId, id: { in: [...uniqueClasseIds] } },
          select: {
            id: true,
            anneeAcademiqueId: true,
            anneeAcademique: { select: { id: true, libelle: true } },
          },
        }),
        this.prisma.user.findMany({
          where: {
            tenantId,
            role: 'ENSEIGNANT',
            id: { in: [...new Set(assignments.map((assignment) => assignment.enseignantId))] },
          },
          select: { id: true },
        }),
      ]);
      if (classes.length !== uniqueClasseIds.size) {
        throw new BadRequestException('Une ou plusieurs classes sont introuvables pour cet établissement');
      }
      const teacherIds = new Set(enseignants.map((enseignant) => enseignant.id));
      if (assignments.some((assignment) => !teacherIds.has(assignment.enseignantId))) {
        throw new BadRequestException('Un ou plusieurs enseignants sont introuvables pour cet établissement');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.matiere.update({
        where: { id: matiereId },
        data: { code, libelle, description, actif },
      });

      if (!shouldSyncAssignments) return;

      const classRows = await tx.classe.findMany({
        where: { tenantId, id: { in: [...new Set(assignments.map((assignment) => assignment.classeId))] } },
        select: {
          id: true,
          anneeAcademiqueId: true,
          anneeAcademique: { select: { id: true, libelle: true } },
        },
      });
      const classById = new Map(classRows.map((classe) => [classe.id, classe]));
      const fallbackAcademicYear = classRows.some((classe) => !classe.anneeAcademiqueId)
        ? await this.ensureCurrentAcademicYear(tenantId)
        : null;

      const existingCourses = await tx.cours.findMany({
        where: { tenantId, matiereId },
        include: {
          _count: { select: { emploisDuTemps: true, appels: true, cahiersTexte: true } },
        },
      });
      const existingById = new Map(existingCourses.map((cours) => [cours.id, cours]));
      const keptCourseIds = new Set<string>();

      for (const assignment of assignments) {
        const classe = classById.get(assignment.classeId);
        const annee = classe?.anneeAcademique ?? fallbackAcademicYear;
        if (!annee?.id) {
          throw new BadRequestException('Aucune année académique disponible pour affecter cette matière');
        }

        const data = {
          tenantId,
          matiereId,
          classeId: assignment.classeId,
          enseignantId: assignment.enseignantId,
          anneeAcademiqueId: annee.id,
          coefficient: assignment.coefficient,
          volumeHoraireHebdo: assignment.volumeHoraireHebdo === null ? null : Math.trunc(assignment.volumeHoraireHebdo),
        };

        if (assignment.coursId && !existingById.has(assignment.coursId)) {
          throw new BadRequestException('Une affectation ne correspond pas à cette matière');
        }

        const cours = assignment.coursId
          ? await tx.cours.update({
              where: { id: assignment.coursId },
              data,
            })
          : await tx.cours.upsert({
              where: {
                matiereId_enseignantId_classeId_anneeAcademiqueId: {
                  matiereId,
                  enseignantId: assignment.enseignantId,
                  classeId: assignment.classeId,
                  anneeAcademiqueId: annee.id,
                },
              },
              update: {
                coefficient: assignment.coefficient,
                volumeHoraireHebdo: assignment.volumeHoraireHebdo === null ? null : Math.trunc(assignment.volumeHoraireHebdo),
              },
              create: data,
            });

        keptCourseIds.add(cours.id);
      }

      const obsoleteCourses = existingCourses.filter((cours) => !keptCourseIds.has(cours.id));
      const blocked = obsoleteCourses.find((cours) =>
        cours._count.emploisDuTemps > 0 || cours._count.appels > 0 || cours._count.cahiersTexte > 0,
      );
      if (blocked) {
        throw new BadRequestException('Impossible de retirer une affectation déjà utilisée dans un emploi du temps, un appel ou un cahier de texte');
      }
      if (obsoleteCourses.length) {
        await tx.cours.deleteMany({ where: { id: { in: obsoleteCourses.map((cours) => cours.id) } } });
      }

      await this.rebuildMatiereClasseForMatiere(tx, tenantId, matiereId);
    });

    return this.hydrateMatiereForAdmin(tenantId, matiereId);
  }

  private async rebuildMatiereClasseForMatiere(client: any, tenantId: string, matiereId: string): Promise<void> {
    const coursRows = await client.cours.findMany({
      where: { tenantId, matiereId },
      include: {
        anneeAcademique: { select: { id: true, libelle: true } },
        classe: {
          select: {
            anneeAcademiqueId: true,
            anneeAcademique: { select: { id: true, libelle: true } },
          },
        },
      },
    });
    const fallbackAcademicYear = coursRows.some((cours: any) => !cours.anneeAcademique && !cours.classe?.anneeAcademique)
      ? await this.ensureCurrentAcademicYear(tenantId)
      : null;

    await client.matiereClasse.deleteMany({ where: { tenantId, matiereId } });
    const rows = [];
    for (const cours of coursRows) {
      const annee = cours.anneeAcademique ?? cours.classe?.anneeAcademique ?? fallbackAcademicYear;
      if (!annee?.id) {
        throw new BadRequestException('Aucune année académique disponible pour affecter cette matière');
      }
      if (cours.anneeAcademiqueId !== annee.id) {
        await client.cours.update({ where: { id: cours.id }, data: { anneeAcademiqueId: annee.id } });
      }
      rows.push({
        tenantId,
        matiereId: cours.matiereId,
        classeId: cours.classeId,
        enseignantId: cours.enseignantId,
        anneeAcademiqueId: annee.id,
        anneeScolaire: annee.libelle,
        volumeHoraire: cours.volumeHoraireHebdo === null || cours.volumeHoraireHebdo === undefined
          ? null
          : Math.trunc(Number(cours.volumeHoraireHebdo)),
      });
    }

    if (rows.length) {
      await client.matiereClasse.createMany({ data: rows, skipDuplicates: true });
    }
  }

  private async hydrateMatiereForAdmin(tenantId: string, matiereId: string): Promise<Payload> {
    const matiere = await this.prisma.matiere.findFirst({
      where: { tenantId, id: matiereId },
      include: {
        _count: { select: { cours: true, notes: true } },
        cours: {
          include: {
            classe: { select: { id: true, nom: true } },
            anneeAcademique: { select: { id: true, libelle: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!matiere) throw new NotFoundException('Matière introuvable');
    const cours = await this.attachEnseignantById((matiere.cours ?? []) as unknown as Payload[]);
    const [withCounts] = await this.attachMatiereDependencyCounts('matiere', [{ ...matiere, cours } as unknown as Payload], tenantId);
    return withCounts;
  }

  async create(config: CrudConfig, tenantId: string | undefined, body: Payload, userOrId?: string | JwtUser) {
    const userId = typeof userOrId === 'string' ? userOrId : userOrId?.sub;
    const parentIds = this.extractStringArray(body.parentIds).map((parentId, index) =>
      this.assertUuid(parentId, `parentIds[${index}]`),
    );
    const stagiaireIds = config.model === 'classe' && Array.isArray(body.stagiaireIds)
      ? body.stagiaireIds.map(String).map((id, index) => this.assertUuid(id, `stagiaireIds[${index}]`))
      : undefined;
    const professeurMatiereIds = config.model === 'user' && config.role === 'ENSEIGNANT' && Array.isArray(body.matiereIds)
      ? [...new Set(body.matiereIds.map(String).map((id, index) => this.assertUuid(id, `matiereIds[${index}]`)))]
      : null;

    const data = await this.prepareData(config, tenantId, body, true, userId);
    const tempPassword = typeof data.__tempPasswordForNotification === 'string'
      ? data.__tempPasswordForNotification
      : null;
    const personnelNiveauId = typeof data.__personnelNiveauId === 'string' ? data.__personnelNiveauId : null;
    const personnelSectionId = typeof data.__personnelSectionId === 'string' ? data.__personnelSectionId : null;
    const personnelAffectationType = typeof data.__personnelAffectationType === 'string' ? data.__personnelAffectationType : null;
    const personnelAllCycles = data.__personnelAllCycles === true;
    const personnelAffectationOrdre = typeof data.__personnelAffectationOrdre === 'number' ? data.__personnelAffectationOrdre : 1;
    delete data.__tempPasswordForNotification;
    delete data.__personnelNiveauId;
    delete data.__personnelSectionId;
    delete data.__personnelAffectationType;
    delete data.__personnelAllCycles;
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

    if (config.model === 'note') {
      await this.applyNoteEvaluationRules(tenantId ?? String(data.tenantId ?? ''), data);
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

    if (config.model === 'cours') {
      await this.rebuildMatiereClasseForMatiere(this.prisma, tenantId ?? String(created.tenantId ?? ''), created.matiereId);
      return this.findOne(config, tenantId, created.id);
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

    if (config.model === 'user' && config.role === 'ENSEIGNANT') {
      if (professeurMatiereIds !== null) {
        await this.replaceProfesseurMatieres(tenantId ?? String(created.tenantId ?? ''), created.id, professeurMatiereIds);
      }
      const result = await this.findOne(config, tenantId, created.id);
      if (tempPassword && result && typeof result === 'object') {
        (result as Record<string, unknown>).generatedPassword = tempPassword;
      }
      return result;
    }

    if (config.model === 'personnel') {
      if (personnelAllCycles && personnelAffectationType === 'SURVEILLANT_GENERAL') {
        await this.replaceSurveillantForAllCycles(tenantId ?? String(data.tenantId ?? ''), String(created.utilisateurId));
      } else if (personnelSectionId && (personnelAffectationType === 'SURVEILLANT' || personnelAffectationType === 'SECRETAIRE_SURVEILLANT')) {
        await this.replaceSurveillantForCycle(tenantId ?? String(data.tenantId ?? ''), personnelSectionId, String(created.utilisateurId));
      }

      if (tempPassword) {
        void this.sendPersonnelCredentials(tenantId, String(created.utilisateurId), tempPassword);
      }
    }

    return this.sanitizeEntity(config.model, created);
  }

  async update(config: CrudConfig, tenantId: string | undefined, id: string, body: Payload) {
    const existingEntity = await this.findOne(config, tenantId, id);
    if (config.model === 'personnel' && !body.utilisateurId && typeof existingEntity.utilisateurId === 'string') {
      body.utilisateurId = existingEntity.utilisateurId;
    }
    const stagiaireIds = config.model === 'classe' && Array.isArray(body.stagiaireIds)
      ? body.stagiaireIds.map(String).map((id, index) => this.assertUuid(id, `stagiaireIds[${index}]`))
      : undefined;
    const professeurMatiereIds = config.model === 'user' && config.role === 'ENSEIGNANT' && Array.isArray(body.matiereIds)
      ? [...new Set(body.matiereIds.map(String).map((matiereId, index) => this.assertUuid(matiereId, `matiereIds[${index}]`)))]
      : null;
    const previousCours = config.model === 'cours'
      ? await this.prisma.cours.findFirst({ where: { id, ...this.fixedWhere(config, tenantId) } })
      : null;

    const data = await this.prepareData(config, tenantId, body, false);
    delete data.__tempPasswordForNotification;
    delete data.__personnelNiveauId;
    const personnelUpdateSectionId = typeof data.__personnelSectionId === 'string' ? data.__personnelSectionId : null;
    const personnelUpdateAffectationType = typeof data.__personnelAffectationType === 'string' ? data.__personnelAffectationType : null;
    const personnelUpdateAllCycles = data.__personnelAllCycles === true;
    delete data.__personnelSectionId;
    delete data.__personnelAffectationType;
    delete data.__personnelAllCycles;
    delete data.__personnelAffectationOrdre;
    if (config.model === 'note') {
      await this.applyNoteEvaluationRules(tenantId ?? String(data.tenantId ?? ''), data, id);
    }
    const updated = await this.delegate(config.model).update({ where: { id }, data });

    if (config.model === 'inscription') {
      await this.syncEleveClasse(updated.eleveId, updated.classeId);
    }

    if (config.model === 'note') {
      await this.refreshBulletinsForNote(tenantId, updated.eleveId, updated.trimestre, updated.anneeScolaire);
    }

    if (config.model === 'cours') {
      const resolvedTenantId = tenantId ?? String(updated.tenantId ?? previousCours?.tenantId ?? '');
      if (previousCours?.matiereId && previousCours.matiereId !== updated.matiereId) {
        await this.rebuildMatiereClasseForMatiere(this.prisma, resolvedTenantId, previousCours.matiereId);
      }
      await this.rebuildMatiereClasseForMatiere(this.prisma, resolvedTenantId, updated.matiereId);
      return this.findOne(config, tenantId, id);
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

    if (config.model === 'user' && config.role === 'ENSEIGNANT') {
      if (professeurMatiereIds !== null) {
        await this.replaceProfesseurMatieres(tenantId ?? String(updated.tenantId ?? ''), id, professeurMatiereIds);
      }
      return this.findOne(config, tenantId, id);
    }

    if (config.model === 'personnel' && personnelUpdateAllCycles && personnelUpdateAffectationType === 'SURVEILLANT_GENERAL') {
      const utilisateurId = String((updated as { utilisateurId: string }).utilisateurId);
      await this.replaceSurveillantForAllCycles(tenantId ?? '', utilisateurId);
    } else if (config.model === 'personnel' && personnelUpdateSectionId && (personnelUpdateAffectationType === 'SURVEILLANT' || personnelUpdateAffectationType === 'SECRETAIRE_SURVEILLANT')) {
      const utilisateurId = String((updated as { utilisateurId: string }).utilisateurId);
      await this.prisma.surveillantCycle.deleteMany({ where: { surveillantId: utilisateurId } });
      await this.replaceSurveillantForCycle(tenantId ?? '', personnelUpdateSectionId, utilisateurId);
    }

    return this.sanitizeEntity(config.model, updated);
  }

  async delete(config: CrudConfig, tenantId: string | undefined, id: string) {
    if (config.model === 'inscription') {
      throw new BadRequestException('SUPPRESSION_INSCRIPTION_INTERDITE: désactivez l’inscription au lieu de la supprimer');
    }
    if (config.model === 'matiere') {
      return this.deleteMatiereIfUnused(tenantId, id);
    }
    await this.findOne(config, tenantId, id);
    const coursToDelete = config.model === 'cours'
      ? await this.prisma.cours.findFirst({ where: { id, ...this.fixedWhere(config, tenantId) } })
      : null;
    await this.delegate(config.model).delete({ where: { id } });
    if (coursToDelete) {
      await this.rebuildMatiereClasseForMatiere(this.prisma, tenantId ?? coursToDelete.tenantId, coursToDelete.matiereId);
    }
  }

  private async deleteMatiereIfUnused(tenantId: string | undefined, id: string): Promise<void> {
    this.assertUuid(id, 'id');
    const resolvedTenantId = this.assertUuid(tenantId, 'tenantId');
    const matiere = await this.prisma.matiere.findFirst({ where: { id, tenantId: resolvedTenantId }, select: { id: true } });
    if (!matiere) throw new NotFoundException('Matière introuvable');

    const [coursCount, notesCount, emploisCount] = await Promise.all([
      this.prisma.cours.count({ where: { tenantId: resolvedTenantId, matiereId: id } }),
      this.prisma.note.count({ where: { tenantId: resolvedTenantId, matiereId: id } }),
      this.prisma.emploiDuTemps.count({ where: { tenantId: resolvedTenantId, matiereId: id } }),
    ]);

    if (coursCount > 0) {
      throw new BadRequestException(`Impossible de supprimer cette matière car elle est utilisée dans ${coursCount} cours. Supprimez d'abord les cours.`);
    }
    if (notesCount > 0) {
      throw new BadRequestException(`Impossible de supprimer cette matière car elle est utilisée dans ${notesCount} note${notesCount > 1 ? 's' : ''}.`);
    }
    if (emploisCount > 0) {
      throw new BadRequestException(`Impossible de supprimer cette matière car elle est utilisée dans ${emploisCount} créneau${emploisCount > 1 ? 'x' : ''} d'emploi du temps.`);
    }

    await this.prisma.$transaction([
      this.prisma.matiereClasse.deleteMany({ where: { tenantId: resolvedTenantId, matiereId: id } }),
      this.prisma.professeurMatiere.deleteMany({ where: { tenantId: resolvedTenantId, matiereId: id } }),
      this.prisma.matiere.delete({ where: { id } }),
    ]);
  }

  private async replaceProfesseurMatieres(tenantId: string, professeurId: string, matiereIds: string[]): Promise<void> {
    const [professeur, matieres] = await Promise.all([
      this.prisma.user.findFirst({ where: { id: professeurId, tenantId, role: 'ENSEIGNANT' }, select: { id: true } }),
      matiereIds.length
        ? this.prisma.matiere.findMany({
            where: { tenantId, id: { in: matiereIds } },
            select: { id: true, libelle: true, code: true },
            orderBy: { libelle: 'asc' },
          })
        : Promise.resolve([]),
    ]);
    if (!professeur) throw new NotFoundException('Professeur introuvable pour cet établissement');
    if (matieres.length !== matiereIds.length) {
      throw new BadRequestException('Une ou plusieurs matières sélectionnées sont introuvables');
    }

    const specialite = matieres
      .map((matiere) => String(matiere.libelle ?? matiere.code ?? '').trim())
      .filter(Boolean)
      .join(', ') || null;

    await this.prisma.$transaction(async (transaction) => {
      await transaction.professeurMatiere.deleteMany({ where: { professeurId, tenantId } });
      if (matiereIds.length) {
        await transaction.professeurMatiere.createMany({
          data: matiereIds.map((matiereId) => ({ tenantId, professeurId, matiereId })),
        });
      }
      await transaction.user.update({ where: { id: professeurId }, data: { specialite } });
    });
  }

  findCurrentAnnee(tenantId: string | undefined) {
    return this.prisma.anneeAcademique.findFirst({
      where: { tenantId, estCourante: true, actif: true },
      orderBy: { dateDebut: 'desc' },
    });
  }

  async activateAnnee(tenantId: string | undefined, id: string) {
    await this.prisma.anneeAcademique.updateMany({
      where: { tenantId, id: { not: id } },
      data: { estCourante: false, actif: false, dateFin: new Date() },
    });
    const updated = await this.prisma.anneeAcademique.update({ where: { id }, data: { estCourante: true, actif: true } });
    await this.terminatePreviousYearInscriptions(tenantId, id);
    return updated;
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
      select: { id: true, eleveId: true },
    });
    if (!inscription) throw new NotFoundException('Inscription introuvable');

    await this.prisma.inscription.update({
      where: { id },
      data: { statut: 'INACTIF' },
    });

    // Also set user.actif = false so the status reflects in the eleve list
    await this.prisma.user.update({
      where: { id: inscription.eleveId },
      data: { actif: false },
    });

    return this.findOne(V1_RESOURCES.inscriptions, tenantId, inscription.id);
  }

  async exclureInscription(tenantId: string | undefined, id: string, nbAnnees = 1) {
    const inscription = await this.prisma.inscription.findFirst({
      where: { id, ...this.fixedWhere(V1_RESOURCES.inscriptions, tenantId) },
      include: { anneeAcademique: { select: { id: true, dateDebut: true } } },
    });
    if (!inscription) throw new NotFoundException('Inscription introuvable');

    const resolvedTenantId = tenantId ?? inscription.tenantId;
    const count = Math.max(1, Math.min(10, Math.trunc(Number(nbAnnees) || 1)));
    const annees = await this.prisma.anneeAcademique.findMany({
      where: {
        tenantId: resolvedTenantId,
        dateDebut: { gte: inscription.anneeAcademique.dateDebut },
      },
      orderBy: { dateDebut: 'asc' },
      take: count,
    });

    await this.prisma.$transaction(
      annees.map((annee, index) => {
        if (index === 0 && annee.id === inscription.anneeAcademiqueId) {
          return this.prisma.inscription.update({
            where: { id: inscription.id },
            data: { statut: 'EXCLU' },
          });
        }
        return this.prisma.inscription.upsert({
          where: {
            tenantId_eleveId_anneeAcademiqueId: {
              tenantId: resolvedTenantId,
              eleveId: inscription.eleveId,
              anneeAcademiqueId: annee.id,
            },
          },
          update: { statut: 'EXCLU' },
          create: {
            tenantId: resolvedTenantId,
            eleveId: inscription.eleveId,
            classeId: inscription.classeId,
            anneeAcademiqueId: annee.id,
            numeroInscription: this.generateInscriptionNumero(resolvedTenantId),
            statut: 'EXCLU',
            creePar: inscription.creePar,
          },
        });
      }),
    );
    return this.findOne(V1_RESOURCES.inscriptions, tenantId, inscription.id);
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
    const absence = await this.prisma.absencePersonnel.findFirst({
      where: { id, tenantId },
      include: { personnel: { select: { utilisateurId: true } } },
    });
    if (!absence) throw new NotFoundException('Absence personnel introuvable');
    if (absence.statut !== 'EN_ATTENTE') {
      throw new BadRequestException('Cette demande a déjà été traitée');
    }

    const updated = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.absencePersonnel.update({
        where: { id },
        data: { statut: 'APPROUVEE', validePar: userId, motifRefus: null },
      });
      await transaction.notification.create({
        data: {
          tenantId: absence.tenantId,
          destinataireId: absence.personnel.utilisateurId,
          titre: 'Absence validée',
          contenu: 'Votre demande d’absence a été validée par l’administration.',
        },
      });
      return updated;
    });
    await this.pushNotifications.sendToUser(absence.tenantId, absence.personnel.utilisateurId, {
      title: 'Absence validée',
      body: 'Votre demande d’absence a été validée par l’administration.',
    });
    return updated;
  }

  async refuseAbsencePersonnel(tenantId: string | undefined, id: string, motifRefus?: unknown, userId?: string) {
    const absence = await this.prisma.absencePersonnel.findFirst({
      where: { id, tenantId },
      include: { personnel: { select: { utilisateurId: true } } },
    });
    if (!absence) throw new NotFoundException('Absence personnel introuvable');
    if (absence.statut !== 'EN_ATTENTE') {
      throw new BadRequestException('Cette demande a déjà été traitée');
    }

    const reason = String(motifRefus ?? '').trim() || null;
    const updated = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.absencePersonnel.update({
        where: { id },
        data: { statut: 'REJETEE', validePar: userId, motifRefus: reason },
      });
      await transaction.notification.create({
        data: {
          tenantId: absence.tenantId,
          destinataireId: absence.personnel.utilisateurId,
          titre: 'Absence refusée',
          contenu: reason
            ? `Votre demande d’absence a été refusée. Motif : ${reason}`
            : 'Votre demande d’absence a été refusée par l’administration.',
        },
      });
      return updated;
    });
    await this.pushNotifications.sendToUser(absence.tenantId, absence.personnel.utilisateurId, {
      title: 'Absence refusée',
      body: reason
        ? `Votre demande d’absence a été refusée. Motif : ${reason}`
        : 'Votre demande d’absence a été refusée par l’administration.',
    });
    return updated;
  }

  async resetPersonnelCredentials(tenantId: string | undefined, personnelId: string) {
    const personnel = await this.prisma.personnel.findFirst({
      where: { id: personnelId, ...(tenantId ? { tenantId } : {}) },
      select: { utilisateurId: true },
    });
    if (!personnel) throw new NotFoundException('Personnel introuvable');
    return this.resetPassword(tenantId, personnel.utilisateurId);
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
    const [stats, notificationsNonLues] = await Promise.all([
      this.cache.getOrSet(this.dashboardCacheKey(tenantId), 8, () =>
        this.prisma.withReadRetry('dashboard etablissement', () => this.loadStatsEtablissement(tenantId)),
      ),
      user?.sub
        ? this.prisma.notification.count({ where: { ...(tenantId ? { tenantId } : {}), destinataireId: user.sub, lu: false } })
        : Promise.resolve(0),
    ]);
    return { ...stats, notificationsNonLues };
  }

  async statsMensuel(tenantId: string | undefined, annee?: string) {
    const year = Number(annee);
    const selectedYear = Number.isFinite(year) && year > 1900 ? year : new Date().getFullYear();
    const cacheKey = `tenant:${tenantId ?? 'platform'}:dashboard-stats-mensuel:${selectedYear}:v1`;
    return this.cache.getOrSet(cacheKey, 8, () =>
      this.prisma.withReadRetry('dashboard etablissement mensuel', () =>
        this.loadStatsMensuel(tenantId, selectedYear),
      ),
    );
  }

  private async loadStatsEtablissement(tenantId: string | undefined) {
    const tenantFilter = tenantId ? { tenantId } : {};
    const today = new Date();
    const startDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
    const [
      eleves,
      professeurs,
      parents,
      personnels,
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
      absencesDuJourEleves,
      absencesDuJourPersonnel,
      reclamationsEnAttente,
      presenceCoursDuJour,
      convocationsEnAttente,
      bulletinsValides,
      bulletinsBrouillons,
      notes,
      dettesRows,
      elevesParClasse,
      professeursParSpecialite,
      paiementsParStatut,
      absencesParStatut,
      bulletinsParStatut,
      derniersPaiements,
      absencesRecentes,
      totalFilles,
      totalGarcons,
      classesSansProfPrincipal,
      elevesSansParent,
      enseignantsAvecEmploiDuTemps,
      classesCycles,
    ] = await Promise.all([
      this.prisma.user.count({ where: { ...tenantFilter, role: 'ELEVE' } }),
      this.prisma.user.count({ where: { ...tenantFilter, role: 'ENSEIGNANT' } }),
      this.prisma.user.count({ where: { ...tenantFilter, role: 'PARENT' } }),
      this.prisma.user.count({ where: { ...tenantFilter, role: { in: ['ADMIN', 'CAISSIER', 'COMPTABLE', 'SURVEILLANT', 'SECURITE', 'RH', 'GESTIONNAIRE'] } } }),
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
      this.prisma.absenceEleve.count({ where: { ...tenantFilter, date: { gte: startDay, lte: endDay } } }),
      this.prisma.absencePersonnel.count({ where: { ...tenantFilter, dateDebut: { lte: endDay }, dateFin: { gte: startDay } } }),
      this.prisma.reclamation.count({ where: { ...tenantFilter, statut: 'EN_ATTENTE' } }),
      this.prisma.presenceCoursProfesseur.aggregate({
        where: { ...tenantFilter, dateCours: { gte: startDay, lte: endDay } },
        _sum: { minutesPlanifiees: true, minutesComptabilisees: true },
        _count: true,
      }),
      this.prisma.convocation.count({ where: { ...tenantFilter, statut: 'EN_ATTENTE' } }),
      this.prisma.bulletin.count({ where: { ...tenantFilter, statut: 'VALIDE' } }),
      this.prisma.bulletin.count({ where: { ...tenantFilter, statut: 'BROUILLON' } }),
      this.prisma.note.aggregate({ where: tenantFilter, _avg: { note: true }, _count: true }),
      this.prisma.paiement.findMany({
        where: {
          ...tenantFilter,
          typePaiement: 'SCOLARITE',
          statut: { in: ['EN_ATTENTE', 'REJETE'] },
        },
        select: {
          eleveId: true,
          montant: true,
          anneeScolaire: true,
          trimestre: true,
          description: true,
          reference: true,
          statut: true,
          createdAt: true,
        },
      }),
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
      this.prisma.user.count({ where: { ...tenantFilter, role: 'ELEVE', genre: 'F' } }),
      this.prisma.user.count({ where: { ...tenantFilter, role: 'ELEVE', genre: 'M' } }),
      this.prisma.classe.count({ where: { ...tenantFilter, actif: true, professeurResponsableId: null } }),
      this.prisma.user.count({ where: { ...tenantFilter, role: 'ELEVE', elevParents: { none: {} } } }),
      this.prisma.emploiDuTemps.findMany({
        where: { ...tenantFilter, enseignantId: { not: null } },
        distinct: ['enseignantId'],
        select: { enseignantId: true },
      }),
      this.prisma.classe.findMany({
        where: tenantFilter,
        select: {
          id: true,
          nom: true,
          _count: { select: { eleves: true, inscriptions: true } },
          niveau: {
            select: {
              libelle: true,
              cycle: { select: { code: true, libelle: true } },
            },
          },
        },
      }),
    ]);
    const enseignantsAvecEdtIds = new Set(
      enseignantsAvecEmploiDuTemps
        .map((item) => item.enseignantId)
        .filter((id): id is string => !!id),
    );
    const enseignantsSansEmploiDuTemps = Math.max(Number(professeurs ?? 0) - enseignantsAvecEdtIds.size, 0);
    const repartitionCyclesMap = new Map<string, { cycle: string; label: string; nb: number }>();
    for (const classe of classesCycles) {
      const cycleLabel = classe.niveau?.cycle?.libelle ?? classe.niveau?.libelle ?? 'Non renseigné';
      const cycleCode = classe.niveau?.cycle?.code ?? cycleLabel;
      const current = repartitionCyclesMap.get(cycleCode) ?? { cycle: cycleCode, label: cycleLabel, nb: 0 };
      current.nb += classe._count.eleves || classe._count.inscriptions || 0;
      repartitionCyclesMap.set(cycleCode, current);
    }
    const repartitionCycles = [...repartitionCyclesMap.values()];
    const debtStudentIds = [...new Set((dettesRows as DebtPaymentRow[]).map((row) => row.eleveId))];
    const debtStudents = debtStudentIds.length
      ? await this.prisma.user.findMany({
          where: {
            ...tenantFilter,
            role: 'ELEVE',
            id: { in: debtStudentIds },
          },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            matricule: true,
          },
        })
      : [];
    const debtSummary = buildDebtDashboardSummary(
      dettesRows as DebtPaymentRow[],
      debtStudents.map((student) => ({
        eleveId: student.id,
        nom: `${student.firstName ?? ''} ${student.lastName ?? ''}`.trim() || 'Élève',
        matricule: student.matricule ?? null,
      })),
    );
    return {
      eleves,
      totalEleves: eleves,
      totalFilles,
      totalGarcons,
      professeurs,
      totalProfesseurs: professeurs,
      parents,
      personnels,
      totalPersonnel: personnels,
      classes,
      totalClasses: classes,
      salles,
      inscriptionsActives,
      absencesEleves,
      absencesEnAttente,
      retardsEleves,
      absencesJustifiees,
      absencesDuJour: Number(absencesDuJourEleves ?? 0) + Number(absencesDuJourPersonnel ?? 0),
      absencesDuJourEleves,
      absencesDuJourPersonnel,
      reclamationsEnAttente,
      presenceDuJour:
        (presenceCoursDuJour._sum.minutesPlanifiees ?? 0) > 0
          ? Math.round((((presenceCoursDuJour._sum.minutesComptabilisees ?? 0) / (presenceCoursDuJour._sum.minutesPlanifiees ?? 1)) * 100))
          : 0,
      convocationsEnAttente,
      bulletinsValides,
      bulletinsBrouillons,
      classesSansProfPrincipal,
      elevesSansParent,
      enseignantsSansEmploiDuTemps,
      repartitionCycles,
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
      dettes: debtSummary,
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
      alertes: [
        ...(absencesDuJourEleves > 0 ? [{
          type: 'danger',
          texte: `${absencesDuJourEleves} absence(s) élève aujourd'hui`,
          href: '/admin/absences-eleves',
        }] : []),
        ...(absencesDuJourPersonnel > 0 ? [{
          type: 'warning',
          texte: `${absencesDuJourPersonnel} absence(s) personnel aujourd'hui`,
          href: '/admin/absences-personnel',
        }] : []),
        ...(convocationsEnAttente > 0 ? [{
          type: 'warning',
          texte: `${convocationsEnAttente} convocation(s) en attente`,
          href: '/admin/convocations',
        }] : []),
        ...(reclamationsEnAttente > 0 ? [{
          type: 'warning',
          texte: `${reclamationsEnAttente} réclamation(s) non traitée(s)`,
          href: '/admin/reclamations',
        }] : []),
        ...(bulletinsBrouillons > 0 ? [{
          type: 'warning',
          texte: `${bulletinsBrouillons} bulletin(s) en brouillon`,
          href: '/admin/bulletins',
        }] : []),
        ...(enseignantsSansEmploiDuTemps > 0 ? [{
          type: 'info',
          texte: `${enseignantsSansEmploiDuTemps} enseignant(s) sans emploi du temps`,
          href: '/admin/emplois-du-temps',
        }] : []),
        ...(elevesSansParent > 0 ? [{
          type: 'info',
          texte: `${elevesSansParent} élève(s) sans parent/tuteur associé`,
          href: '/admin/eleves',
        }] : []),
        ...(paiementsEnAttente > 0 ? [{
          type: 'info',
          texte: `${paiementsEnAttente} paiement(s) en attente`,
          href: '/admin/paiements',
        }] : []),
      ],
    };
  }

  private async loadStatsMensuel(tenantId: string | undefined, year: number) {
    const tenantFilter = tenantId ? { tenantId } : {};
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31, 23, 59, 59, 999);
    const [paiements, absences, eleves] = await Promise.all([
      this.prisma.paiement.findMany({
        where: { ...tenantFilter, createdAt: { gte: start, lte: end } },
        select: { montant: true, statut: true, createdAt: true, datePaiement: true },
      }),
      this.prisma.absenceEleve.findMany({
        where: { ...tenantFilter, date: { gte: start, lte: end } },
        select: { date: true, typeAbsence: true },
      }),
      this.prisma.user.count({ where: { ...tenantFilter, role: 'ELEVE' } }),
    ]);
    const months = Array.from({ length: 12 }, (_, index) => ({
      mois: index + 1,
      encaissements: 0,
      fraisAttendus: 0,
      absences: 0,
      retards: 0,
      tauxPresence: 0,
    }));

    for (const paiement of paiements) {
      const date = paiement.datePaiement ?? paiement.createdAt;
      const item = months[date.getMonth()];
      item.fraisAttendus += Number(paiement.montant ?? 0);
      if (paiement.statut === 'VALIDE') {
        item.encaissements += Number(paiement.montant ?? 0);
      }
    }

    for (const absence of absences) {
      const item = months[absence.date.getMonth()];
      if (absence.typeAbsence === 'RETARD') item.retards += 1;
      else item.absences += 1;
    }

    for (const item of months) {
      const totalIncidents = item.absences + item.retards;
      item.tauxPresence = eleves > 0 ? Math.max(0, Math.round(((eleves - totalIncidents) / eleves) * 100)) : 0;
      item.encaissements = Math.round(item.encaissements);
      item.fraisAttendus = Math.round(item.fraisAttendus);
    }

    return months;
  }

  private dashboardCacheKey(tenantId: string | undefined): string {
    return `tenant:${tenantId ?? 'platform'}:dashboard-stats:v3`;
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

  async appbarNotifications(tenantId: string | undefined, user?: JwtUser, query?: QueryParams) {
    if (!user?.sub) {
      return [];
    }

    const tenantFilter = tenantId ? { tenantId } : {};
    const requestedLimit = Number(Array.isArray(query?.limit) ? query?.limit[0] : query?.limit);
    const all = String(Array.isArray(query?.all) ? query?.all[0] : query?.all ?? '').toLowerCase() === 'true';
    const take = all ? 200 : (Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 10);
    return this.prisma.notification.findMany({
      where: { ...tenantFilter, destinataireId: user.sub },
      orderBy: { createdAt: 'desc' },
      take,
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

    const [inscriptions, bulletins, absences, allNotes, dettes] = await Promise.all([
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
      this.prisma.paiement.findMany({
        where: {
          tenantId,
          eleveId,
          typePaiement: 'SCOLARITE',
          statut: { in: ['EN_ATTENTE', 'REJETE'] },
        },
        select: {
          eleveId: true,
          montant: true,
          anneeScolaire: true,
          trimestre: true,
          description: true,
          reference: true,
          statut: true,
          createdAt: true,
        },
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
      dettes: buildDebtSummary(dettes as DebtPaymentRow[]),
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

  async adminEleveDettes(tenantId: string | undefined, eleveId: string) {
    this.assertUuid(eleveId, 'eleveId');
    const eleve = await this.prisma.user.findFirst({
      where: { id: eleveId, tenantId, role: 'ELEVE' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        matricule: true,
      },
    });
    if (!eleve) throw new NotFoundException('Eleve introuvable');

    const dettes = await this.prisma.paiement.findMany({
      where: {
        tenantId,
        eleveId,
        typePaiement: 'SCOLARITE',
        statut: { in: ['EN_ATTENTE', 'REJETE'] },
      },
      select: {
        eleveId: true,
        montant: true,
        anneeScolaire: true,
        trimestre: true,
        description: true,
        reference: true,
        statut: true,
        createdAt: true,
      },
      orderBy: [{ anneeScolaire: 'desc' }, { createdAt: 'desc' }],
    });

    return {
      eleve: {
        id: eleve.id,
        nom: `${eleve.firstName ?? ''} ${eleve.lastName ?? ''}`.trim() || 'Élève',
        matricule: eleve.matricule ?? null,
      },
      ...buildDebtSummary(dettes as DebtPaymentRow[]),
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
    // School identity can change at any time. Always render from current tenant
    // configuration so a new download never shows an old logo or school name.
    const withPdf = await this.attachBulletinPdf(tenantId, bulletin as Record<string, any>);
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
      select: { eleveId: true },
    });

    const studentIds = inscriptions.map((inscription) => inscription.eleveId);
    if (!studentIds.length) return [];

    // Resolve niveauId for this class
    const classe = await this.prisma.classe.findUnique({ where: { id: classeId }, select: { niveauId: true } });

    // All class data is read in parallel.
    const [notes, absenceRows, matiereNiveaux] = await Promise.all([
      this.prisma.note.findMany({
        where: { tenantId, eleveId: { in: studentIds }, trimestre, anneeScolaire },
        select: { eleveId: true, matiereId: true, note: true, noteSur: true, typeEvaluation: true },
      }),
      this.prisma.absenceEleve.groupBy({
        by: ['eleveId', 'typeAbsence'],
        where: { tenantId, eleveId: { in: studentIds } },
        _count: { _all: true },
      }),
      classe?.niveauId
        ? this.prisma.matiereNiveau.findMany({
            where: { tenantId, niveauId: classe.niveauId },
            select: { matiereId: true, coefficient: true },
          })
        : [],
    ]);

    // Coefficients from MatiereNiveau (source of truth)
    const coefficients = new Map(matiereNiveaux.map((mn) => [mn.matiereId, mn.coefficient ?? 1]));
    const averages = calculateBulletinAverages(studentIds, notes, coefficients);
    const absencesByStudent = new Map<string, { total: number; retards: number }>();
    for (const row of absenceRows) {
      const current = absencesByStudent.get(row.eleveId) ?? { total: 0, retards: 0 };
      current.total += row._count._all;
      if (row.typeAbsence === 'RETARD') current.retards += row._count._all;
      absencesByStudent.set(row.eleveId, current);
    }

    // Eight concurrent upserts keep batch requests fast without exhausting the pool.
    const bulletins = await mapWithConcurrency(inscriptions, 8, async ({ eleveId }) => {
      const absence = absencesByStudent.get(eleveId) ?? { total: 0, retards: 0 };
      const data = {
        moyenne: averages.get(eleveId) ?? 0,
        totalEleves: studentIds.length,
        nombreAbsences: absence.total,
        nombreRetards: absence.retards,
        moyenneClasse: 0,
        soumisPar: userId,
        statut: 'BROUILLON' as const,
        validePar: null,
        fichierPdfUrl: null,
      };

      return this.prisma.bulletin.upsert({
        where: {
          eleveId_classeId_trimestre_anneeScolaire: { eleveId, classeId, trimestre, anneeScolaire },
        },
        update: data,
        create: {
          tenantId,
          eleveId,
          classeId,
          trimestre,
          anneeScolaire,
          ...data,
        },
      });
    });

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
    if (search) {
      const searchConditions = this.buildSearchConditions(config.model, search);
      if (searchConditions.length) where.OR = searchConditions;
    }
    await this.applyModelSpecificFilters(where, config, tenantId, query);
    return where;
  }

  private buildSearchConditions(model: string, search: string): Payload[] {
    const contains = { contains: search, mode: 'insensitive' };
    const byFields = (fields: string[]) => fields.map((field) => ({ [field]: contains }));

    switch (model) {
      case 'user':
        return byFields([
          'firstName',
          'lastName',
          'username',
          'email',
          'telephone',
          'adresse',
          'profession',
          'lieuTravail',
          'telephoneTravail',
          'matricule',
          'numeroIdentificationNational',
          'lieuNaissance',
        ]);
      case 'cycle':
      case 'niveau':
        return byFields(['code', 'libelle']);
      case 'anneeAcademique':
        return byFields(['libelle']);
      case 'batiment':
        return byFields(['nom', 'description']);
      case 'salle':
        return byFields(['nom', 'typeSalle']);
      case 'classe':
        return [
          ...byFields(['nom']),
          { niveau: { is: { OR: byFields(['code', 'libelle']) } } },
          { anneeAcademique: { is: { libelle: contains } } },
        ];
      case 'matiere':
        return byFields(['code', 'libelle', 'description']);
      case 'personnel':
        return [
          ...byFields(['numeroMatricule']),
          {
            utilisateur: {
              is: {
                OR: byFields(['firstName', 'lastName', 'username', 'email', 'telephone', 'adresse', 'specialite', 'matricule']),
              },
            },
          },
        ];
      case 'paiement':
        return byFields(['reference', 'transactionId', 'anneeScolaire', 'trimestre', 'description']);
      case 'absenceEleve':
        return byFields(['motif', 'documentUrl']);
      case 'emploiDuTemps':
        return byFields(['jourSemaine', 'heureDebut', 'heureFin', 'anneeScolaire']);
      case 'cahierTexte':
        return byFields(['contenuTraite', 'observations', 'etapeProgramme']);
      case 'convocation':
        return byFields(['motif', 'statut', 'compteRendu']);
      case 'notification':
        return byFields(['titre', 'contenu']);
      case 'annonce':
        return byFields(['titre', 'contenu']);
      case 'note':
        return byFields(['trimestre', 'anneeScolaire', 'commentaire']);
      case 'bulletin':
        return byFields(['trimestre', 'anneeScolaire', 'appreciation']);
      case 'reclamation':
        return byFields(['motif', 'reponse']);
      case 'calendrierScolaire':
        return byFields(['titre', 'description', 'type']);
      default:
        return [];
    }
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
      // Normalisation des noms : NOM en MAJUSCULES, Prénom capitalize, lieu de naissance en MAJUSCULES
      if (data.lastName) data.lastName = String(data.lastName).trim().toUpperCase();
      if (data.firstName) data.firstName = String(data.firstName).trim().replace(/\b\w/g, (c: string) => c.toUpperCase());
      if (data.lieuNaissance) data.lieuNaissance = String(data.lieuNaissance).trim().toUpperCase();
      if (data.adresse) data.adresse = String(data.adresse).trim().toUpperCase();
      const phoneCountry = await this.resolveTenantPhoneCountry(tenantId ?? String(data.tenantId ?? ''));
      for (const field of ['telephone', 'numeroUrgence', 'telephoneTravail']) {
        if (data[field] !== undefined) {
          data[field] = normalizePhoneForCountry(data[field], phoneCountry) ?? null;
        }
      }
      if (create && data.role === 'ENSEIGNANT' && !data.telephone) {
        throw new BadRequestException('telephone est requis pour créer un professeur');
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
      if (create && data.role === 'ELEVE') {
        const lieuNaissance = String(data.lieuNaissance ?? '').trim();
        if (lieuNaissance) data.lieuNaissance = lieuNaissance;
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
      if (typeof data.photoUrl === 'string' && data.photoUrl.startsWith('data:')) delete data.photoUrl;
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
      delete data.matiereIds;
      delete data.matieresEnseignees;
      delete data.classesAssignees;
      delete data.salaire;
    }

    if (config.model === 'inscription' && create) {
      data.anneeAcademiqueId ??= (await this.ensureCurrentAcademicYear(tenantId ?? String(data.tenantId ?? ''))).id;
      data.numeroInscription ??= `INS-${Date.now().toString(36).toUpperCase()}`;
      data.creePar ??= userId ?? data.utilisateurId ?? '00000000-0000-0000-0000-000000000000';
      data.statut ??= 'ACTIF';

      // Auto-remplir fraisInscription depuis la config si non fourni
      if (data.fraisInscription === undefined || data.fraisInscription === null) {
        try {
          const classe = await this.prisma.classe.findFirst({
            where: { id: String(data.classeId) },
            include: { niveau: { include: { cycle: true } } },
          });
          if (classe?.niveau?.cycle) {
            const fraisConfig = await this.prisma.fraisNiveauConfig.findFirst({
              where: { tenantId: tenantId ?? String(data.tenantId ?? ''), section: classe.niveau.cycle.libelle, niveau: classe.niveau.libelle, actif: true },
            });
            if (fraisConfig) {
              data.fraisInscription = fraisConfig.inscription + (fraisConfig.mensualite * fraisConfig.nbMois);
            }
          }
        } catch { /* silencieux si pas de config frais */ }
      }

      // Generate cardToken for the student if not already set
      const eleveIdForToken = String(data.eleveId ?? '');
      if (eleveIdForToken) {
        const eleveForToken = await this.prisma.user.findUnique({ where: { id: eleveIdForToken }, select: { cardToken: true } });
        if (eleveForToken && !eleveForToken.cardToken) {
          await this.prisma.user.update({ where: { id: eleveIdForToken }, data: { cardToken: randomBytes(16).toString('hex') } });
        }
      }

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
      if (create) {
        if (data.justifiee) data.statut ??= 'JUSTIFIEE';
        else data.statut ??= 'EN_ATTENTE';
      }
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
      `Edusen - Accès ${audience}`,
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
      SECURITE: 'sécurité',
      CAISSIER: 'caissier',
      COMPTABLE: 'comptable',
      RH: 'ressources humaines',
      GESTIONNAIRE: 'gestionnaire',
    };
    return labels[normalized] ?? 'utilisateur';
  }

  private async attachMatiereDependencyCounts<T extends Payload>(model: string, rows: T[], tenantId?: string): Promise<T[]> {
    if (model !== 'matiere' || rows.length === 0 || !tenantId) return rows;

    const matiereIds = [...new Set(rows.map((row) => String(row.id ?? '')).filter(Boolean))];
    if (matiereIds.length === 0) return rows;

    const [coursRows, noteRows, emploiRows] = await Promise.all([
      this.prisma.cours.groupBy({
        by: ['matiereId'],
        where: { tenantId, matiereId: { in: matiereIds } },
        _count: { _all: true },
      }),
      this.prisma.note.groupBy({
        by: ['matiereId'],
        where: { tenantId, matiereId: { in: matiereIds } },
        _count: { _all: true },
      }),
      this.prisma.emploiDuTemps.groupBy({
        by: ['matiereId'],
        where: { tenantId, matiereId: { in: matiereIds } },
        _count: { _all: true },
      }),
    ]);

    const coursByMatiere = new Map(coursRows.map((row) => [row.matiereId, row._count._all]));
    const notesByMatiere = new Map(noteRows.map((row) => [row.matiereId, row._count._all]));
    const emploisByMatiere = new Map(emploiRows.map((row) => [row.matiereId, row._count._all]));

    return rows.map((row) => {
      const matiereId = String(row.id ?? '');
      const cours = coursByMatiere.get(matiereId) ?? 0;
      const notes = notesByMatiere.get(matiereId) ?? 0;
      const emploisDuTemps = emploisByMatiere.get(matiereId) ?? 0;
      const existingCount = (row._count ?? {}) as Payload;
      return {
        ...row,
        _count: { ...existingCount, cours, notes },
        dependencyCounts: { cours, notes, emploisDuTemps },
      };
    });
  }

  private sanitizeEntity(model: string, entity: Payload): Payload {
    if (!entity) return entity;
    if (model === 'user') {
      const {
        passwordHash: _passwordHash,
        eleveClasse,
        matieresEnseignees,
        ...safeEntity
      } = entity as Payload & {
        passwordHash?: string;
        eleveClasse?: Payload;
        matieresEnseignees?: Array<{ matiere?: Payload }>;
      };
      if (safeEntity.photoUrl) safeEntity.photoUrl = this.storage.resolveUrl(safeEntity.photoUrl as string) ?? undefined;
      if (eleveClasse && !safeEntity.classe) {
        safeEntity.classe = eleveClasse;
      }
      if ((safeEntity.classe || eleveClasse) && !safeEntity.eleveClasse) {
        safeEntity.eleveClasse = (safeEntity.classe ?? eleveClasse) as Payload;
      }
      const specialites = (matieresEnseignees ?? [])
        .map((link) => link?.matiere)
        .filter((matiere): matiere is Payload => !!matiere)
        .sort((a, b) => String(a.libelle ?? a.code ?? '').localeCompare(String(b.libelle ?? b.code ?? ''), 'fr'));
      if (specialites.length > 0) {
        safeEntity.specialites = specialites;
        safeEntity.specialite = specialites
          .map((matiere) => String(matiere.libelle ?? matiere.code ?? ''))
          .filter(Boolean)
          .join(', ');
      } else if (safeEntity.role === 'ENSEIGNANT') {
        safeEntity.specialites = [];
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
    if (model === 'user') return this.attachCurrentClasseForStudents(rows, tenantId);
    if (model === 'inscription') return this.attachInscriptionEleves(rows, tenantId);
    if (model === 'bulletin' || model === 'absenceEleve' || model === 'reclamation') {
      return this.attachEleveById(rows);
    }
    if (model === 'paiement') return this.attachEleveById(rows);
    if (model === 'cours') return this.attachEnseignantById(rows);
    if (model === 'pointage') return this.attachPointagePersonnel(rows);
    if (model === 'note') {
      const withEleves = await this.attachEleveById(rows);
      return tenantId ? this.attachNoteCoefficients(tenantId, withEleves) : withEleves;
    }
    if (model === 'convocation') return this.attachEleveById(rows);
    return rows;
  }

  private async attachCurrentClasseForStudents<T extends Payload>(rows: T[], tenantId?: string): Promise<T[]> {
    if (!tenantId || rows.length === 0) return rows;
    const eleveIds = rows
      .filter((row) => String(row.role ?? '').toUpperCase() === 'ELEVE')
      .map((row) => String(row.id ?? ''))
      .filter(Boolean);
    if (eleveIds.length === 0) return rows;

    const inscriptions = await this.prisma.inscription.findMany({
      where: { tenantId, eleveId: { in: [...new Set(eleveIds)] }, statut: 'ACTIF' },
      include: {
        classe: { select: { id: true, nom: true } },
        anneeAcademique: { select: { id: true, libelle: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const inscriptionByEleve = new Map<string, (typeof inscriptions)[number]>();
    for (const inscription of inscriptions) {
      if (!inscriptionByEleve.has(inscription.eleveId)) {
        inscriptionByEleve.set(inscription.eleveId, inscription);
      }
    }

    return rows.map((row) => {
      if (String(row.role ?? '').toUpperCase() !== 'ELEVE') return row;
      const inscription = inscriptionByEleve.get(String(row.id ?? ''));
      const classe = (row.classe as Payload | undefined) ?? (row.eleveClasse as Payload | undefined) ?? inscription?.classe ?? null;
      return {
        ...row,
        classeId: row.classeId ?? inscription?.classeId ?? classe?.id ?? null,
        classe,
        eleveClasse: classe,
        anneeAcademique: row.anneeAcademique ?? inscription?.anneeAcademique?.libelle ?? null,
        anneeAcademiqueId: row.anneeAcademiqueId ?? inscription?.anneeAcademiqueId ?? null,
        inscription: inscription
          ? {
              id: inscription.id,
              numeroInscription: inscription.numeroInscription,
              statut: inscription.statut,
              classeId: inscription.classeId,
              anneeAcademiqueId: inscription.anneeAcademiqueId,
              classe: inscription.classe,
              anneeAcademique: inscription.anneeAcademique,
            }
          : row.inscription ?? null,
      };
    });
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
    if (config.model === 'inscription' && key === 'statut') return true;
    if (config.model === 'user' && key === 'statut') return true;

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
      case 'inscription': {
        const statut = this.first(query.statut)?.toUpperCase();
        const currentAnnee = await this.findCurrentAnnee(tenantId);
        if (statut === 'ACTIF') {
          where.statut = 'ACTIF';
          if (currentAnnee && !where.anneeAcademiqueId) where.anneeAcademiqueId = currentAnnee.id;
        } else if (statut === 'INACTIF') {
          const inactiveScope: Payload[] = [
            { statut: 'INACTIF' },
            { statut: 'TERMINE' },
            ...(currentAnnee ? [{ statut: 'ACTIF', anneeAcademiqueId: { not: currentAnnee.id } }] : []),
          ];
          const existingAnd = Array.isArray(where.AND) ? where.AND as Payload[] : [];
          where.AND = [...existingAnd, { OR: inactiveScope }];
        } else if (statut) {
          where.statut = statut;
        }
        break;
      }
      case 'appel': {
        this.applyDateRangeFilter(where, 'dateCours', from, to);
        break;
      }
      case 'user': {
        const statut = this.first(query.statut);
        if (statut === 'actif') where.actif = true;
        else if (statut === 'inactif') where.actif = false;
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

  private async attachInscriptionEleves<T extends Payload>(inscriptions: T[], tenantId?: string): Promise<T[]> {
    const eleveIds = [...new Set(inscriptions.map((inscription) => String(inscription.eleveId ?? '')).filter(Boolean))];
    if (eleveIds.length === 0) return inscriptions;

    const eleves = await this.prisma.user.findMany({
      where: { id: { in: eleveIds } },
      select: { id: true, firstName: true, lastName: true, matricule: true, photoUrl: true },
    });
    const elevesById = new Map(eleves.map((eleve) => [
      eleve.id,
      { ...eleve, photoUrl: eleve.photoUrl ? (this.storage.resolveUrl(eleve.photoUrl) ?? undefined) : undefined },
    ]));
    const currentAnnee = tenantId ? await this.findCurrentAnnee(tenantId) : null;

    return inscriptions.map((inscription) => ({
      ...inscription,
      statut: currentAnnee
        && inscription.statut === 'ACTIF'
        && String(inscription.anneeAcademiqueId ?? '') !== currentAnnee.id
          ? 'INACTIF'
          : inscription.statut,
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

    return initials || compact.slice(0, 15) || 'edusen';
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
      matiereNiveau: [...common, 'niveauId', 'matiereId'],
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

    // Map enseignantPrincipalId to professeurResponsableId
    if (data.enseignantPrincipalId && !data.professeurResponsableId) {
      data.professeurResponsableId = data.enseignantPrincipalId;
    }

    // Validate teacher type for prescolaire/primaire classes
    const profId = String(data.professeurResponsableId ?? '');
    const niveauIdForValidation = String(data.niveauId ?? '');
    if (profId && niveauIdForValidation) {
      const [profUser, niveauData] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: profId }, select: { specialite: true } }),
        this.prisma.niveau.findFirst({ where: { id: niveauIdForValidation }, include: { cycle: { select: { code: true } } } }),
      ]);
      const cycleCode = (niveauData?.cycle?.code ?? '').toUpperCase();
      const primaryCycles = ['PRESCOLAIRE', 'PRIMAIRE', 'MATERNELLE', 'CRECHE', 'ELEMENTAIRE'];
      if (primaryCycles.includes(cycleCode) && profUser?.specialite) {
        const isPrescolaire = ['PRESCOLAIRE', 'MATERNELLE', 'CRECHE'].includes(cycleCode);
        const expectedType = isPrescolaire ? 'PRESCOLAIRE' : 'PRIMAIRE';
        const profType = profUser.specialite.toUpperCase();
        if (profType !== expectedType && profType !== '') {
          throw new BadRequestException(`Cet enseignant est de type ${profType}. Une classe ${cycleCode.toLowerCase()} necessite un enseignant de type ${expectedType}.`);
        }
        // Check one-teacher-per-class rule
        const existingClass = await this.prisma.classe.findFirst({
          where: { tenantId, professeurResponsableId: profId, actif: true },
          include: { niveau: { select: { cycle: { select: { code: true } } } } },
        });
        if (existingClass && primaryCycles.includes((existingClass.niveau?.cycle?.code ?? '').toUpperCase())) {
          throw new BadRequestException(`Cet enseignant est deja responsable de la classe ${existingClass.nom}. Au prescolaire/primaire, un enseignant ne peut avoir qu'une seule classe.`);
        }
      }
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

    if (!data.matiereId && create) {
      throw new BadRequestException('Veuillez sélectionner une matière pour ce cours');
    }
    if (!data.classeId && create) {
      throw new BadRequestException('Veuillez sélectionner une classe pour ce cours');
    }

    if (data.matiereId !== undefined && data.matiereId !== null && data.matiereId !== '') {
      const matiereId = this.assertUuid(String(data.matiereId), 'matiereId');
      const matiere = await this.prisma.matiere.findFirst({
        where: { id: matiereId, tenantId },
        select: { id: true },
      });
      if (!matiere) throw new BadRequestException('Matière introuvable pour cet établissement');
      data.matiereId = matiereId;
    }

    if (data.classeId !== undefined && data.classeId !== null && data.classeId !== '') {
      const classeId = this.assertUuid(String(data.classeId), 'classeId');
      const classe = await this.prisma.classe.findFirst({
        where: { id: classeId, tenantId },
        select: {
          id: true,
          anneeAcademiqueId: true,
          anneeAcademique: { select: { id: true } },
        },
      });
      if (!classe) throw new BadRequestException('Classe introuvable pour cet établissement');
      data.classeId = classeId;
      if (!data.anneeAcademiqueId) {
        data.anneeAcademiqueId = classe.anneeAcademiqueId ?? (await this.ensureCurrentAcademicYear(tenantId)).id;
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

    if (data.montantParHeure !== undefined && data.montantHoraire === undefined) {
      data.montantHoraire = data.montantParHeure;
    }
    if (data.montantHoraire !== undefined && data.montantHoraire !== null && data.montantHoraire !== '') {
      const montant = Number(data.montantHoraire);
      if (!Number.isFinite(montant) || montant <= 0) {
        throw new BadRequestException('Montant par heure invalide');
      }
      data.montantHoraire = montant;
    } else if (data.montantHoraire === '' || data.montantHoraire === undefined) {
      if (create) {
        const config = await this.prisma.ecoleConfig.findUnique({
          where: { tenantId },
          select: { montantHoraireDefaut: true },
        });
        data.montantHoraire = config?.montantHoraireDefaut ?? null;
      } else if (data.montantHoraire === '') {
        data.montantHoraire = null;
      }
    }

    if (create && (data.montantHoraire === null || data.montantHoraire === undefined)) {
      throw new BadRequestException('Le montant par heure est obligatoire pour créer un cours');
    }

    // Enseignant : champ obligatoire du modèle Cours
    const rawEnseignant = data.enseignantId ?? data.enseignant ?? data.professeurId;
    if (rawEnseignant !== undefined && rawEnseignant !== null && String(rawEnseignant).trim() !== '') {
      const enseignantId = this.assertUuid(String(rawEnseignant).trim(), 'enseignantId');
      const enseignant = await this.prisma.user.findFirst({
        where: { id: enseignantId, tenantId, role: 'ENSEIGNANT' },
        select: { id: true, specialite: true },
      });
      if (!enseignant) {
        throw new BadRequestException('Enseignant introuvable pour cet établissement');
      }
      if (data.matiereId) {
        const [habilitation, matiere] = await Promise.all([
          this.prisma.professeurMatiere.findFirst({
            where: { tenantId, professeurId: enseignantId, matiereId: String(data.matiereId) },
            select: { id: true },
          }),
          this.prisma.matiere.findFirst({
            where: { id: String(data.matiereId), tenantId },
            select: { libelle: true, code: true },
          }),
        ]);
        const legacySpecialites = String(enseignant.specialite ?? '')
          .split(',')
          .map((value) => this.normalizeSubjectName(value))
          .filter(Boolean);
        const legacyMatch = matiere
          ? legacySpecialites.includes(this.normalizeSubjectName(matiere.libelle))
            || legacySpecialites.includes(this.normalizeSubjectName(matiere.code))
          : false;
        if (!habilitation && !legacyMatch) {
          throw new BadRequestException('Ce professeur n’est pas habilité à enseigner cette matière');
        }
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
    if (data.anneeAcademiqueId !== undefined && data.anneeAcademiqueId !== null && data.anneeAcademiqueId !== '') {
      const anneeAcademiqueId = this.assertUuid(String(data.anneeAcademiqueId), 'anneeAcademiqueId');
      const annee = await this.prisma.anneeAcademique.findFirst({
        where: { id: anneeAcademiqueId, tenantId },
        select: { id: true },
      });
      if (!annee) throw new BadRequestException('Année académique introuvable pour cet établissement');
      data.anneeAcademiqueId = anneeAcademiqueId;
    }

    // `description` n'existe pas sur le modèle Cours -> on l'écarte toujours
    delete data.description;
    delete data.enseignant;
    delete data.professeurId;
    delete data.titre;
    delete data.dateDebut;
    delete data.dateFin;
    delete data.heures;
    delete data.montantParHeure;
  }

  private normalizeSubjectName(value: unknown): string {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLocaleLowerCase();
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
    if (data.motifRefus === '') data.motifRefus = null;
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
    const allowedTypes = new Set(['DISCIPLINAIRE', 'ACADEMIQUE', 'ADMINISTRATIF']);
    const type = String(data.type ?? '').trim().toUpperCase();
    data.type = allowedTypes.has(type) ? type : 'DISCIPLINAIRE';
    if (data.observations === '') data.observations = null;
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
    if (data.methode !== undefined && data.methode !== null) {
      data.methode = String(data.methode).trim().toUpperCase() || null;
    }
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

    if (affectationType === 'SURVEILLANT_GENERAL') {
      data.__personnelAllCycles = true;
      data.__personnelAffectationType = affectationType;
    } else if (affectationType === 'SURVEILLANT' || affectationType === 'SECRETAIRE_SURVEILLANT') {
      if (!sectionId) throw new BadRequestException('sectionId est requis pour ce personnel');
      const section = await this.prisma.cycle.findFirst({ where: { id: sectionId, tenantId } });
      if (!section) throw new BadRequestException('Section introuvable');
      data.__personnelSectionId = sectionId;
      data.__personnelAffectationType = affectationType;
    }

    const firstName = String(data.prenom ?? data.firstName ?? '').trim();
    const lastName = String(data.nom ?? data.lastName ?? '').trim();
    const incomingEmail = String(data.email ?? '').trim().toLowerCase();
    const role = this.normalizePersonnelRole(data.type);

    if ((!data.utilisateurId || !this.isUuidLike(String(data.utilisateurId))) && (incomingEmail || (create && firstName && lastName))) {
      const email = incomingEmail;

      const existingUser = email
        ? await this.prisma.user.findFirst({ where: { tenantId, email } })
        : null;

      if (existingUser) {
        data.utilisateurId = existingUser.id;
      } else if (firstName && lastName) {
        const username = await this.generateUsername(tenantId, firstName, lastName);
        const generatedEmail = email || `${username}@local.noura-school`;
        const generatedPassword = this.generateTempPassword();
        const passwordHash = await bcrypt.hash(generatedPassword, 12);
        const createdUser = await this.prisma.user.create({
          data: {
            tenantId,
            username,
            email: generatedEmail,
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

    if (data.utilisateurId && this.isUuidLike(String(data.utilisateurId))) {
      const userUpdate: Record<string, unknown> = {};
      if (firstName) userUpdate['firstName'] = firstName;
      if (lastName) userUpdate['lastName'] = lastName;
      if (incomingEmail) userUpdate['email'] = incomingEmail;
      if (normalizedTelephone) userUpdate['telephone'] = normalizedTelephone;
      if (data.adresse !== undefined) userUpdate['adresse'] = data.adresse ? String(data.adresse) : null;
      if (data.specialite !== undefined) userUpdate['specialite'] = data.specialite ? String(data.specialite) : null;
      if (data.type !== undefined) userUpdate['role'] = role;
      if (Object.keys(userUpdate).length > 0) {
        await this.prisma.user.updateMany({
          where: { id: String(data.utilisateurId), tenantId },
          data: userUpdate,
        });
      }
    }

    if (create && (!data.utilisateurId || !this.isUuidLike(String(data.utilisateurId)))) {
      throw new BadRequestException('Impossible de créer le personnel sans prénom et nom valides');
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
    await this.prisma.surveillantCycle.deleteMany({ where: { tenantId, cycleId, surveillantId: { not: newSurveillantId } } });
    await this.prisma.surveillantCycle.upsert({
      where: { surveillantId_cycleId: { surveillantId: newSurveillantId, cycleId } },
      create: { tenantId, surveillantId: newSurveillantId, cycleId },
      update: {},
    });
  }

  private async replaceSurveillantForAllCycles(tenantId: string, surveillantId: string): Promise<void> {
    const cycles = await this.prisma.cycle.findMany({ where: { tenantId, actif: true }, select: { id: true } });
    await this.prisma.$transaction([
      this.prisma.surveillantCycle.deleteMany({ where: { tenantId, surveillantId } }),
      this.prisma.surveillantCycle.deleteMany({ where: { tenantId, cycleId: { in: cycles.map((cycle) => cycle.id) }, surveillantId: { not: surveillantId } } }),
      ...(cycles.length
        ? [this.prisma.surveillantCycle.createMany({
            data: cycles.map((cycle) => ({ tenantId, surveillantId, cycleId: cycle.id })),
            skipDuplicates: true,
          })]
        : []),
    ]);
  }

  private normalizePersonnelRole(value: unknown): 'ENSEIGNANT' | 'SURVEILLANT' | 'SECURITE' | 'CAISSIER' | 'RH' | 'COMPTABLE' {
    const role = String(value ?? '').trim().toUpperCase();
    if (role === 'ENSEIGNANT') return 'ENSEIGNANT';
    if (role === 'SURVEILLANT' || role === 'SURVEILLANT_GENERAL' || role === 'SECRETAIRE_SURVEILLANT') return 'SURVEILLANT';
    if (role === 'SECURITE' || role === 'GARDIEN' || role === 'AGENT_SECURITE' || role === 'AGENT_DE_SECURITE') return 'SECURITE';
    if (role === 'CAISSIER') return 'CAISSIER';
    if (role === 'COMPTABLE') return 'COMPTABLE';
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
      'SECURITE',
      'GARDIEN',
      'AGENT_SECURITE',
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

  private async applyNoteEvaluationRules(tenantId: string, data: Payload, currentNoteId?: string): Promise<void> {
    if (!tenantId) throw new BadRequestException('tenantId requis pour enregistrer une note');

    const current = currentNoteId
      ? await this.prisma.note.findFirst({
          where: { id: currentNoteId, tenantId },
          select: {
            eleveId: true,
            matiereId: true,
            typeEvaluation: true,
            trimestre: true,
            anneeScolaire: true,
            commentaire: true,
          },
        })
      : null;

    const eleveId = String(data.eleveId ?? current?.eleveId ?? '').trim();
    const matiereId = String(data.matiereId ?? current?.matiereId ?? '').trim();
    const trimestre = String(data.trimestre ?? current?.trimestre ?? '').trim();
    const anneeScolaire = String(data.anneeScolaire ?? current?.anneeScolaire ?? '').trim();
    const typeEvaluation = String(data.typeEvaluation ?? current?.typeEvaluation ?? 'DEVOIR').trim().toUpperCase();
    const allowed = new Set(['DEVOIR', 'INTERROGATION', 'EXAMEN', 'COMPOSITION', 'CONTROLE', 'TP', 'ORAL']);

    if (!allowed.has(typeEvaluation)) {
      throw new BadRequestException(`Type d'évaluation invalide: ${typeEvaluation}`);
    }
    if (!eleveId || !matiereId || !trimestre || !anneeScolaire) {
      throw new BadRequestException('eleveId, matiereId, trimestre et anneeScolaire sont requis pour une note');
    }

    data.eleveId = eleveId;
    data.matiereId = matiereId;
    data.trimestre = trimestre;
    data.anneeScolaire = anneeScolaire;
    data.typeEvaluation = typeEvaluation;

    if (typeEvaluation === 'DEVOIR') {
      data.commentaire = await this.resolveDevoirCommentaire(tenantId, {
        eleveId,
        matiereId,
        trimestre,
        anneeScolaire,
        commentaire: data.commentaire !== undefined ? data.commentaire : current?.commentaire,
        currentNoteId,
      });
      return;
    }

    if (typeEvaluation === 'COMPOSITION') {
      const duplicate = await this.prisma.note.findFirst({
        where: {
          tenantId,
          eleveId,
          matiereId,
          trimestre,
          anneeScolaire,
          typeEvaluation: 'COMPOSITION',
          ...(currentNoteId ? { id: { not: currentNoteId } } : {}),
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException('Une composition existe déjà pour cet élève, cette matière et cette période.');
      }
      data.commentaire = this.cleanNoteCommentaire(data.commentaire !== undefined ? data.commentaire : current?.commentaire) || 'Composition';
    }
  }

  private async resolveDevoirCommentaire(
    tenantId: string,
    scope: {
      eleveId: string;
      matiereId: string;
      trimestre: string;
      anneeScolaire: string;
      commentaire: unknown;
      currentNoteId?: string;
    },
  ): Promise<string> {
    const existing = await this.prisma.note.findMany({
      where: {
        tenantId,
        eleveId: scope.eleveId,
        matiereId: scope.matiereId,
        trimestre: scope.trimestre,
        anneeScolaire: scope.anneeScolaire,
        typeEvaluation: 'DEVOIR',
        ...(scope.currentNoteId ? { id: { not: scope.currentNoteId } } : {}),
      },
      select: { id: true, commentaire: true, dateEvaluation: true, createdAt: true },
      orderBy: [{ dateEvaluation: 'asc' }, { createdAt: 'asc' }],
    });
    const occupied = this.occupiedDevoirSlots(existing);
    const requestedSlot = this.devoirSlot(scope.commentaire);

    if (requestedSlot) {
      if (occupied.has(requestedSlot)) {
        throw new ConflictException(`Le Devoir ${requestedSlot} existe déjà pour cet élève, cette matière et cette période.`);
      }
      return `Devoir ${requestedSlot}`;
    }

    const nextSlot = this.nextDevoirSlot(occupied);
    if (!nextSlot) {
      throw new BadRequestException('Un élève ne peut pas avoir plus de 3 notes de devoir par matière et période.');
    }
    return `Devoir ${nextSlot}`;
  }

  private occupiedDevoirSlots(notes: Array<{ commentaire: string | null }>): Set<number> {
    const occupied = new Set<number>();
    const unlabeled = notes.filter((note) => !this.devoirSlot(note.commentaire));

    for (const note of notes) {
      const slot = this.devoirSlot(note.commentaire);
      if (slot) occupied.add(slot);
    }
    for (const _note of unlabeled) {
      const slot = this.nextDevoirSlot(occupied);
      if (slot) occupied.add(slot);
    }
    return occupied;
  }

  private devoirSlot(value: unknown): number | null {
    const normalized = String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
    const match = normalized.match(/^(?:devoir|dev|d)\s*([123])$/);
    return match ? Number(match[1]) : null;
  }

  private nextDevoirSlot(occupied: Set<number>): number | null {
    for (const slot of [1, 2, 3]) {
      if (!occupied.has(slot)) return slot;
    }
    return null;
  }

  private cleanNoteCommentaire(value: unknown): string | null {
    const commentaire = String(value ?? '').trim();
    return commentaire || null;
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
    });

    // Sort in JavaScript to guarantee correct descending order (highest average = rank 1)
    bulletins.sort((a, b) => (Number(b.moyenne) || 0) - (Number(a.moyenne) || 0));

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
    const [bulletins, { moyenne }] = await Promise.all([
      this.prisma.bulletin.findMany({ where: { tenantId, eleveId, trimestre, anneeScolaire }, select: { id: true } }),
      this.computeStudentAverage(tenantId, eleveId, trimestre, anneeScolaire),
    ]);

    if (!bulletins.length) return;

    // A PDF is built only when downloaded. Rebuilding and uploading it on every
    // note edit made grade entry depend on storage latency and could serve stale data.
    await mapWithConcurrency(bulletins, 4, ({ id }) =>
      this.prisma.bulletin.update({ where: { id }, data: { moyenne, fichierPdfUrl: null } }),
    );
  }

  private async attachBulletinPdf(tenantId: string | undefined, bulletin: Record<string, any>) {
    if (!tenantId) return bulletin;
    const { buffer } = await this.bulletinDocument.generate(tenantId, String(bulletin.id));
    const key = this.storage.buildBulletinKey(tenantId, String(bulletin.eleveId), String(bulletin.trimestre), String((bulletin as any).anneeScolaire ?? ''));
    const fichierPdfUrl = await this.storage.upload(key, buffer, 'application/pdf');
    return this.prisma.bulletin.update({ where: { id: bulletin.id }, data: { fichierPdfUrl } });
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
        select: { id: true, statut: true },
      }),
      this.prisma.classe.findFirst({
        where: { tenantId, id: classeId },
        select: { anneeAcademiqueId: true },
      }),
    ]);

    if (existing) {
      if (existing.statut === 'EXCLU') {
        throw new BadRequestException('ELEVE_EXCLU: cet élève est exclu pour cette année scolaire');
      }
      throw new BadRequestException('INSCRIPTION_DEJA_EXISTANTE: cet élève est déjà inscrit pour cette année scolaire');
    }

    if (!classe) {
      throw new BadRequestException('CLASSE_INTROUVABLE');
    }

    if (classe.anneeAcademiqueId !== anneeAcademiqueId) {
      throw new BadRequestException('CLASSE_ANNEE_INVALIDE: la classe ne correspond pas à l’année scolaire choisie');
    }
  }

  private async terminatePreviousYearInscriptions(tenantId: string | undefined, currentAnneeId: string): Promise<void> {
    if (!tenantId) return;
    await this.prisma.inscription.updateMany({
      where: {
        tenantId,
        statut: 'ACTIF',
        anneeAcademiqueId: { not: currentAnneeId },
      },
      data: { statut: 'INACTIF' },
    });
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
        statut: lastInscription.statut,
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

    // Use the target class's academic year (not the current year) to avoid
    // "already inscribed" errors when the student has an active inscription
    // for the current year but the passage targets a class in a different year.
    const classeDest = await this.prisma.classe.findFirst({
      where: { id: demande.classeDestId, tenantId },
      select: { anneeAcademiqueId: true },
    });
    const targetAnneeId = classeDest?.anneeAcademiqueId ?? demande.anneeAcademiqueId;
    if (!targetAnneeId) throw new BadRequestException('Aucune année académique associée à la classe de destination');

    // Un passage peut viser une classe de l'année suivante (nouvelle inscription)
    // ou une classe de l'année en cours (simple changement de classe).
    // Dans le second cas, créer une seconde inscription violerait la contrainte
    // « une inscription par élève et par année » et remontait à l'utilisateur
    // sous la forme trompeuse « Élève déjà inscrit cette année ».
    const inscriptionExistante = await this.prisma.inscription.findFirst({
      where: {
        tenantId,
        eleveId: demande.eleveId,
        anneeAcademiqueId: targetAnneeId,
        statut: { notIn: ['TRANSFERE', 'EXCLU', 'TERMINE'] },
      },
      select: { id: true, classeId: true },
    });

    if (inscriptionExistante) {
      if (inscriptionExistante.classeId === demande.classeDestId) {
        throw new BadRequestException(
          'Cet élève est déjà inscrit dans la classe demandée pour cette année',
        );
      }

      // Changement de classe au sein de la même année : on déplace l'inscription.
      const [updated] = await this.prisma.$transaction([
        this.prisma.demandePassage.update({
          where: { id },
          data: { statut: 'APPROUVEE', traitePar: userId ?? null },
          include: this.demandePassageInclude(),
        }),
        this.prisma.inscription.update({
          where: { id: inscriptionExistante.id },
          data: { classeId: demande.classeDestId },
        }),
      ]);

      return updated;
    }

    await this.assertSingleInscriptionPerYear(tenantId, {
      eleveId: demande.eleveId,
      classeId: demande.classeDestId,
      anneeAcademiqueId: targetAnneeId,
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
          anneeAcademiqueId: targetAnneeId,
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
