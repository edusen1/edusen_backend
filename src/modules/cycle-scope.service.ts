import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import type { JwtUser } from '@/common/types/auth.types';

/**
 * Cloisonnement par cycle.
 *
 * Le surveillant est responsable d'un cycle (préscolaire, élémentaire, moyen ou
 * secondaire) et ne doit voir que ce cycle. Le modèle le prévoit depuis toujours
 * via `SurveillantCycle`, mais le filtrage n'était appliqué que dans un seul
 * service : en pratique un surveillant voyait les 32 classes et les 256 élèves
 * de l'établissement, exactement comme l'administrateur.
 *
 * Ce service centralise la règle pour qu'elle soit appliquée partout de la même
 * façon.
 *
 * **Convention de retour :**
 * - `null` → aucune restriction (administrateur, ou tout rôle non cloisonné) ;
 * - `string[]` → seuls ces cycles sont visibles.
 *
 * **Un tableau vide est volontaire et signifie « rien n'est visible ».**
 * L'implémentation précédente renvoyait `null` lorsque le surveillant n'avait
 * aucun cycle affecté, ce qui lui ouvrait tout l'établissement — une sécurité
 * ouverte par défaut. Un surveillant sans affectation ne doit rien voir : c'est
 * une erreur de configuration à corriger, pas un droit d'accès total.
 */
@Injectable()
export class CycleScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /** Rôles dont la visibilité est restreinte à leurs cycles affectés. */
  private static readonly ROLES_CLOISONNES = new Set(['SURVEILLANT']);

  async visibleCycleIds(tenantId: string, user?: JwtUser): Promise<string[] | null> {
    if (!user || !CycleScopeService.ROLES_CLOISONNES.has(user.role)) return null;
    const rows = await this.prisma.surveillantCycle.findMany({
      where: { tenantId, surveillantId: user.sub },
      select: { cycleId: true },
    });
    return rows.map((row) => row.cycleId);
  }

  /** `true` si l'utilisateur est soumis au cloisonnement. */
  estCloisonne(user?: JwtUser): boolean {
    return !!user && CycleScopeService.ROLES_CLOISONNES.has(user.role);
  }

  /**
   * Fragment `where` Prisma pour une entité reliée au cycle via
   * `classe → niveau → cycleId`. Renvoie `{}` si aucun cloisonnement.
   */
  async whereParClasse(tenantId: string, user?: JwtUser): Promise<Record<string, unknown>> {
    const cycleIds = await this.visibleCycleIds(tenantId, user);
    if (cycleIds === null) return {};
    return { classe: { niveau: { cycleId: { in: cycleIds } } } };
  }

  /** Fragment `where` pour une entité portant directement `niveauId`. */
  async whereParNiveau(tenantId: string, user?: JwtUser): Promise<Record<string, unknown>> {
    const cycleIds = await this.visibleCycleIds(tenantId, user);
    if (cycleIds === null) return {};
    return { niveau: { cycleId: { in: cycleIds } } };
  }

  /**
   * Vérifie qu'une classe appartient bien au périmètre de l'utilisateur.
   * À utiliser sur les écritures : filtrer les lectures ne suffit pas, sinon un
   * surveillant peut encore modifier une classe d'un autre cycle en connaissant
   * son identifiant.
   */
  /** Idem pour un niveau, porte d'entrée des programmes pédagogiques. */
  async niveauEstVisible(tenantId: string, niveauId: string, user?: JwtUser): Promise<boolean> {
    const cycleIds = await this.visibleCycleIds(tenantId, user);
    if (cycleIds === null) return true;
    if (cycleIds.length === 0 || !niveauId) return false;
    const niveau = await this.prisma.niveau.findFirst({
      where: { id: niveauId, cycleId: { in: cycleIds } },
      select: { id: true },
    });
    return !!niveau;
  }

  /**
   * Identifiants des niveaux appartenant aux cycles donnés.
   * `ProgrammePedagogique.niveauId` est une colonne simple, sans relation Prisma
   * vers `Niveau` : on ne peut donc pas filtrer par `niveau: { cycleId }` et il
   * faut résoudre les niveaux au préalable.
   */
  async niveauIdsDesCycles(cycleIds: string[]): Promise<string[]> {
    if (cycleIds.length === 0) return [];
    const niveaux = await this.prisma.niveau.findMany({
      where: { cycleId: { in: cycleIds } },
      select: { id: true },
    });
    return niveaux.map((n) => n.id);
  }

  /** Niveaux visibles par l'utilisateur, ou `null` s'il n'est pas cloisonné. */
  async visibleNiveauIds(tenantId: string, user?: JwtUser): Promise<string[] | null> {
    const cycleIds = await this.visibleCycleIds(tenantId, user);
    if (cycleIds === null) return null;
    return this.niveauIdsDesCycles(cycleIds);
  }

  /** Idem pour un programme, via son niveau. */
  async programmeEstVisible(tenantId: string, programmeId: string, user?: JwtUser): Promise<boolean> {
    const niveauIds = await this.visibleNiveauIds(tenantId, user);
    if (niveauIds === null) return true;
    if (niveauIds.length === 0) return false;
    const prog = await this.prisma.programmePedagogique.findFirst({
      where: { id: programmeId, tenantId, niveauId: { in: niveauIds } },
      select: { id: true },
    });
    return !!prog;
  }

  /**
   * Lève une 403 si la ressource est hors périmètre.
   * À appeler sur toute écriture : le filtrage des lectures n'empêche pas
   * d'écrire sur un identifiant deviné ou obtenu par un autre canal.
   */
  assertVisible(estVisible: boolean): void {
    if (!estVisible) {
      throw new ForbiddenException("Cette ressource n'appartient pas à votre cycle");
    }
  }

  async classeEstVisible(tenantId: string, classeId: string, user?: JwtUser): Promise<boolean> {
    const cycleIds = await this.visibleCycleIds(tenantId, user);
    if (cycleIds === null) return true;
    if (cycleIds.length === 0) return false;
    const classe = await this.prisma.classe.findFirst({
      where: { id: classeId, tenantId, niveau: { cycleId: { in: cycleIds } } },
      select: { id: true },
    });
    return !!classe;
  }
}
