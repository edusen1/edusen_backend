import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/config/prisma.service';
import { objetJson } from '@/common/utils/grille-horaire.util';

/**
 * Bibliothèque : catalogue et emprunts.
 *
 * Deux règles structurent ce module :
 *
 * 1. **La durée fait foi, pas la date.** L'agent saisit un nombre de jours ;
 *    la date de retour en découle. Laisser saisir une date ouvrait la porte à
 *    des durées incohérentes d'un emprunt à l'autre.
 * 2. **Un retard ou une perte produit une dette.** Le montant est calculé ici,
 *    à partir des tarifs de l'école, puis encaissé par la caisse. Sans montant
 *    calculé côté serveur, chaque écran aurait sa propre règle.
 */

export interface TarifsBibliotheque {
  /** Durée d'emprunt proposée par défaut. */
  dureeJoursDefaut: number;
  /** Durée maximale autorisée. */
  dureeJoursMax: number;
  /** Pénalité par jour de retard, en FCFA. */
  penaliteParJour: number;
  /** Plafond de la pénalité de retard. 0 = pas de plafond. */
  penaliteMax: number;
  /** Montant réclamé en cas de perte quand l'ouvrage n'a pas de valeur connue. */
  valeurRemplacementDefaut: number;
}

export const TARIFS_PAR_DEFAUT: TarifsBibliotheque = {
  dureeJoursDefaut: 14,
  dureeJoursMax: 60,
  penaliteParJour: 100,
  penaliteMax: 5000,
  valeurRemplacementDefaut: 10000,
};

@Injectable()
export class BibliothequeService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Tarifs ────────────────────────────────────────────────────────

  async getTarifs(tenantId: string): Promise<TarifsBibliotheque> {
    const config = await this.prisma.ecoleConfig.findUnique({
      where: { tenantId },
      select: { tarifsBibliotheque: true },
    });
    // Colonne JSON : même précaution que pour la grille horaire — la valeur
    // pourrait être un tableau ou un scalaire, formes qu'on écarte.
    return { ...TARIFS_PAR_DEFAUT, ...objetJson<TarifsBibliotheque>(config?.tarifsBibliotheque) };
  }

  async updateTarifs(tenantId: string, tarifs: Partial<TarifsBibliotheque>): Promise<TarifsBibliotheque> {
    const fusionnes = { ...(await this.getTarifs(tenantId)), ...tarifs };
    await this.prisma.ecoleConfig.update({
      where: { tenantId },
      data: { tarifsBibliotheque: fusionnes as unknown as Prisma.InputJsonValue },
    });
    return fusionnes;
  }

  // ── Catalogue ─────────────────────────────────────────────────────

  async listOuvrages(tenantId: string, query: Record<string, string> = {}) {
    const where: Prisma.OuvrageWhereInput = { tenantId, actif: true };
    if (query.type) where.type = query.type as never;
    const recherche = (query.search ?? '').trim();
    if (recherche) {
      where.OR = [
        { titre: { contains: recherche, mode: 'insensitive' } },
        { auteur: { contains: recherche, mode: 'insensitive' } },
        { isbn: { contains: recherche, mode: 'insensitive' } },
        { editeur: { contains: recherche, mode: 'insensitive' } },
      ];
    }
    // `size` est transmis par le frontend : l'ignorer tronquait silencieusement
    // les grands catalogues à une valeur codée en dur.
    const size = Math.min(Math.max(Number(query.size ?? 200) || 200, 1), 1000);
    return this.prisma.ouvrage.findMany({ where, orderBy: [{ titre: 'asc' }], take: size });
  }

  async createOuvrage(tenantId: string, dto: Record<string, unknown>) {
    const titre = String(dto.titre ?? '').trim();
    const auteur = String(dto.auteur ?? '').trim();
    if (!titre) throw new BadRequestException('Titre requis');
    if (!auteur) throw new BadRequestException('Auteur requis');
    const nbExemplaires = Math.max(1, Number(dto.nbExemplaires ?? 1));

    return this.prisma.ouvrage.create({
      data: {
        tenantId, titre, auteur,
        type: (dto.type as never) ?? 'MANUEL',
        isbn: (dto.isbn as string)?.trim() || null,
        annee: dto.annee ? Number(dto.annee) : null,
        editeur: (dto.editeur as string)?.trim() || null,
        valeur: dto.valeur ? Number(dto.valeur) : null,
        nbExemplaires,
        nbDisponibles: nbExemplaires,
        matiereId: (dto.matiereId as string) || null,
        niveauId: (dto.niveauId as string) || null,
      },
    });
  }

  async updateOuvrage(tenantId: string, id: string, dto: Record<string, unknown>) {
    const ouvrage = await this.prisma.ouvrage.findFirst({ where: { id, tenantId } });
    if (!ouvrage) throw new NotFoundException('Ouvrage introuvable');

    const data: Prisma.OuvrageUpdateInput = {};
    if (dto.titre !== undefined) data.titre = String(dto.titre).trim();
    if (dto.auteur !== undefined) data.auteur = String(dto.auteur).trim();
    if (dto.type !== undefined) data.type = dto.type as never;
    if (dto.isbn !== undefined) data.isbn = (dto.isbn as string)?.trim() || null;
    if (dto.annee !== undefined) data.annee = dto.annee ? Number(dto.annee) : null;
    if (dto.editeur !== undefined) data.editeur = (dto.editeur as string)?.trim() || null;
    if (dto.valeur !== undefined) data.valeur = dto.valeur ? Number(dto.valeur) : null;

    // Modifier le nombre d'exemplaires doit reporter l'écart sur les
    // disponibles, sinon un ajout de stock resterait invisible à l'emprunt.
    if (dto.nbExemplaires !== undefined) {
      const nouveau = Math.max(1, Number(dto.nbExemplaires));
      const ecart = nouveau - ouvrage.nbExemplaires;
      data.nbExemplaires = nouveau;
      data.nbDisponibles = Math.max(0, Math.min(nouveau, ouvrage.nbDisponibles + ecart));
    }

    return this.prisma.ouvrage.update({ where: { id }, data });
  }

  /** Retrait du catalogue — conformément à la règle « on archive, on ne supprime pas ». */
  async archiverOuvrage(tenantId: string, id: string) {
    const ouvrage = await this.prisma.ouvrage.findFirst({ where: { id, tenantId } });
    if (!ouvrage) throw new NotFoundException('Ouvrage introuvable');
    const empruntsActifs = await this.prisma.empruntOuvrage.count({
      where: { ouvrageId: id, statut: { in: ['EN_COURS', 'EN_RETARD'] } },
    });
    if (empruntsActifs > 0) {
      throw new BadRequestException(`${empruntsActifs} exemplaire(s) encore en circulation : retrait impossible`);
    }
    return this.prisma.ouvrage.update({ where: { id }, data: { actif: false } });
  }

  // ── Emprunts ──────────────────────────────────────────────────────

  async listEmprunts(tenantId: string, query: Record<string, string> = {}) {
    const where: Prisma.EmpruntOuvrageWhereInput = { tenantId };
    if (query.statut) where.statut = query.statut as never;
    if (query.emprunteurId) where.emprunteurId = query.emprunteurId;

    const emprunts = await this.prisma.empruntOuvrage.findMany({
      where,
      include: {
        ouvrage: { select: { id: true, titre: true, auteur: true, valeur: true } },
        emprunteur: { select: { id: true, firstName: true, lastName: true, matricule: true, role: true } },
      },
      orderBy: [{ dateEmprunt: 'desc' }],
      take: 500,
    });

    // Le retard se déduit de la date : le recalculer à la lecture évite de
    // dépendre d'une tâche planifiée pour que le statut soit juste.
    const maintenant = new Date();
    return emprunts.map((e) => ({
      ...e,
      statut: e.statut === 'EN_COURS' && e.dateRetourPrevue < maintenant ? 'EN_RETARD' : e.statut,
      joursRetard: this.joursRetard(e.dateRetourPrevue, e.dateRetourReelle ?? maintenant),
    }));
  }

  async creerEmprunt(tenantId: string, dto: Record<string, unknown>, enregistreParId?: string) {
    const ouvrageId = String(dto.ouvrageId ?? '');
    const emprunteurId = String(dto.emprunteurId ?? '');
    if (!ouvrageId) throw new BadRequestException('Ouvrage requis');
    if (!emprunteurId) throw new BadRequestException('Emprunteur requis');

    const tarifs = await this.getTarifs(tenantId);
    const dureeJours = Math.max(1, Number(dto.dureeJours ?? tarifs.dureeJoursDefaut));
    if (dureeJours > tarifs.dureeJoursMax) {
      throw new BadRequestException(`La durée maximale d'emprunt est de ${tarifs.dureeJoursMax} jours`);
    }

    const ouvrage = await this.prisma.ouvrage.findFirst({ where: { id: ouvrageId, tenantId, actif: true } });
    if (!ouvrage) throw new NotFoundException('Ouvrage introuvable');
    if (ouvrage.nbDisponibles <= 0) throw new BadRequestException('Aucun exemplaire disponible');

    const emprunteur = await this.prisma.user.findFirst({
      where: { id: emprunteurId, tenantId },
      select: { id: true, role: true },
    });
    if (!emprunteur) throw new NotFoundException('Emprunteur introuvable');

    // Un emprunteur déjà en retard ne peut pas emprunter à nouveau : sans cette
    // règle, les retards s'accumulent sans qu'aucun écran ne le signale.
    const enRetard = await this.prisma.empruntOuvrage.count({
      where: { tenantId, emprunteurId, statut: { in: ['EN_COURS', 'EN_RETARD'] }, dateRetourPrevue: { lt: new Date() } },
    });
    if (enRetard > 0) {
      throw new BadRequestException('Cet emprunteur a déjà un ouvrage en retard');
    }

    const dateEmprunt = new Date();
    const dateRetourPrevue = new Date(dateEmprunt);
    dateRetourPrevue.setDate(dateRetourPrevue.getDate() + dureeJours);

    /**
     * Le stock est décrémenté **sous condition**, dans la transaction.
     * Le contrôle de disponibilité fait plus haut ne suffit pas : deux agents
     * servant le dernier exemplaire au même instant le passaient tous deux, et
     * `nbDisponibles` tombait à −1. Ici, la seconde écriture ne trouve aucune
     * ligne à mettre à jour et la transaction échoue.
     */
    return this.prisma.$transaction(async (tx) => {
      const reserve = await tx.ouvrage.updateMany({
        where: { id: ouvrageId, tenantId, nbDisponibles: { gt: 0 } },
        data: { nbDisponibles: { decrement: 1 } },
      });
      if (reserve.count === 0) {
        throw new BadRequestException('Aucun exemplaire disponible');
      }
      return tx.empruntOuvrage.create({
        data: {
          tenantId, ouvrageId, emprunteurId,
          typeEmprunteur: emprunteur.role === 'ELEVE' ? 'ELEVE' : 'ENSEIGNANT',
          dateEmprunt, dureeJours, dateRetourPrevue,
          observations: (dto.observations as string)?.trim() || null,
          enregistreParId: enregistreParId ?? null,
        },
      });
    });
  }

  /** Retour d'un ouvrage. L'amende de retard est calculée ici. */
  async retournerEmprunt(tenantId: string, id: string) {
    const emprunt = await this.prisma.empruntOuvrage.findFirst({ where: { id, tenantId } });
    if (!emprunt) throw new NotFoundException('Emprunt introuvable');
    if (emprunt.statut === 'RENDU') throw new BadRequestException('Cet ouvrage a déjà été rendu');
    if (emprunt.statut === 'PERDU') throw new BadRequestException('Cet ouvrage est déclaré perdu');

    const tarifs = await this.getTarifs(tenantId);
    const dateRetourReelle = new Date();
    const retard = this.joursRetard(emprunt.dateRetourPrevue, dateRetourReelle);
    let montantAmende: number | null = null;
    if (retard > 0 && tarifs.penaliteParJour > 0) {
      const brut = retard * tarifs.penaliteParJour;
      montantAmende = tarifs.penaliteMax > 0 ? Math.min(brut, tarifs.penaliteMax) : brut;
    }

    const [maj] = await this.prisma.$transaction([
      this.prisma.empruntOuvrage.update({
        where: { id },
        data: { statut: 'RENDU', dateRetourReelle, montantAmende },
      }),
      this.prisma.ouvrage.update({ where: { id: emprunt.ouvrageId }, data: { nbDisponibles: { increment: 1 } } }),
    ]);
    return { ...maj, joursRetard: retard };
  }

  /**
   * Déclaration de perte. L'exemplaire ne revient pas au stock : le nombre
   * d'exemplaires est décrémenté, faute de quoi le catalogue afficherait
   * indéfiniment un ouvrage qui n'existe plus.
   */
  async declarerPerte(tenantId: string, id: string, observations?: string) {
    const emprunt = await this.prisma.empruntOuvrage.findFirst({
      where: { id, tenantId },
      include: { ouvrage: { select: { id: true, valeur: true, nbExemplaires: true } } },
    });
    if (!emprunt) throw new NotFoundException('Emprunt introuvable');
    if (emprunt.statut === 'PERDU') throw new BadRequestException('Perte déjà déclarée');

    const tarifs = await this.getTarifs(tenantId);
    const montantAmende = emprunt.ouvrage.valeur ?? tarifs.valeurRemplacementDefaut;

    const [maj] = await this.prisma.$transaction([
      this.prisma.empruntOuvrage.update({
        where: { id },
        data: { statut: 'PERDU', montantAmende, observations: observations?.trim() || emprunt.observations },
      }),
      this.prisma.ouvrage.update({
        where: { id: emprunt.ouvrageId },
        data: { nbExemplaires: Math.max(0, emprunt.ouvrage.nbExemplaires - 1) },
      }),
    ]);
    return maj;
  }

  /**
   * Règlement d'une amende : crée l'écriture de caisse et la relie à l'emprunt.
   *
   * **Limite assumée** : `Paiement.eleveId` est obligatoire dans le modèle, le
   * registre des paiements ne connaît que les élèves. Une amende d'enseignant ne
   * peut donc pas y entrer — elle est refusée ici plutôt qu'enregistrée sur un
   * élève arbitraire, ce qui fausserait les comptes de cet élève. Les amendes du
   * personnel relèvent d'un autre circuit, à définir.
   */
  async reglerAmende(tenantId: string, id: string, dto: Record<string, unknown>, validePar?: string) {
    const emprunt = await this.prisma.empruntOuvrage.findFirst({
      where: { id, tenantId },
      include: { ouvrage: { select: { titre: true } } },
    });
    if (!emprunt) throw new NotFoundException('Emprunt introuvable');
    if (!emprunt.montantAmende) throw new BadRequestException('Aucune amende sur cet emprunt');
    if (emprunt.paiementId) throw new BadRequestException('Amende déjà réglée');
    if (emprunt.typeEmprunteur !== 'ELEVE') {
      throw new BadRequestException(
        "Les amendes du personnel ne passent pas par la caisse élèves : à traiter hors bibliothèque",
      );
    }

    const inscription = await this.prisma.inscription.findFirst({
      where: { tenantId, eleveId: emprunt.emprunteurId, statut: 'ACTIF' },
      select: { id: true, anneeAcademique: { select: { libelle: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const paiement = await this.prisma.paiement.create({
      data: {
        tenantId,
        eleveId: emprunt.emprunteurId,
        inscriptionId: inscription?.id ?? null,
        reference: `BIB-${Date.now().toString(36).toUpperCase()}`,
        montant: emprunt.montantAmende,
        typePaiement: 'AUTRE',
        modePaiement: (dto.modePaiement as never) ?? 'ESPECES',
        statut: 'VALIDE',
        anneeScolaire: inscription?.anneeAcademique?.libelle ?? String(new Date().getFullYear()),
        description: `Bibliothèque — ${emprunt.statut === 'PERDU' ? 'ouvrage perdu' : 'retard'} : ${emprunt.ouvrage.titre}`,
        datePaiement: new Date(),
        validePar: validePar ?? null,
      },
    });

    return this.prisma.empruntOuvrage.update({
      where: { id },
      data: { paiementId: paiement.id },
    });
  }

  /**
   * Situation d'un emprunteur, consultée avant de lui confier un ouvrage.
   *
   * L'agent doit voir *avant* de valider si la personne détient déjà des
   * ouvrages, accuse un retard ou a perdu un livre. Le refus se produisait
   * jusqu'ici au moment de l'enregistrement, sans que rien ne l'ait annoncé.
   */
  async situationEmprunteur(tenantId: string, emprunteurId: string) {
    const emprunts = await this.listEmprunts(tenantId, { emprunteurId });
    const enCours = emprunts.filter((e) => e.statut === 'EN_COURS');
    const enRetard = emprunts.filter((e) => e.statut === 'EN_RETARD');
    const pertes = emprunts.filter((e) => e.statut === 'PERDU');
    const amendesDues = emprunts
      .filter((e) => e.montantAmende && !e.paiementId)
      .reduce((somme, e) => somme + (e.montantAmende ?? 0), 0);

    return {
      nbEnCours: enCours.length,
      nbEnRetard: enRetard.length,
      nbPertes: pertes.length,
      amendesDues,
      /** Un retard bloque tout nouvel emprunt — même règle que `creerEmprunt`. */
      peutEmprunter: enRetard.length === 0,
      ouvragesEnCours: [...enCours, ...enRetard].map((e) => ({
        id: e.id,
        titre: e.ouvrage?.titre ?? '—',
        dateRetourPrevue: e.dateRetourPrevue,
        enRetard: e.statut === 'EN_RETARD',
        joursRetard: e.joursRetard,
      })),
      pertes: pertes.map((e) => ({ id: e.id, titre: e.ouvrage?.titre ?? '—', montantAmende: e.montantAmende })),
    };
  }

  /** Emprunts d'un utilisateur — alimente les espaces élève et enseignant. */
  async mesEmprunts(tenantId: string, emprunteurId: string) {
    const emprunts = await this.listEmprunts(tenantId, { emprunteurId });
    const enCours = emprunts.filter((e) => e.statut === 'EN_COURS' || e.statut === 'EN_RETARD');
    const amendesDues = emprunts
      .filter((e) => e.montantAmende && !e.paiementId)
      .reduce((somme, e) => somme + (e.montantAmende ?? 0), 0);
    return {
      enCours,
      historique: emprunts.filter((e) => e.statut === 'RENDU' || e.statut === 'PERDU'),
      nbEnRetard: emprunts.filter((e) => e.statut === 'EN_RETARD').length,
      amendesDues,
    };
  }

  private joursRetard(prevue: Date, reelle: Date): number {
    const millisecondesParJour = 24 * 60 * 60 * 1000;
    const ecart = Math.floor((reelle.getTime() - prevue.getTime()) / millisecondesParJour);
    return Math.max(0, ecart);
  }
}
