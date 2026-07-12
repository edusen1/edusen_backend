import { Body, Controller, Get, Headers, Param, Post, Query, Req } from "@nestjs/common";
import { Roles } from "@/common/decorators/roles.decorator";
import { DomainService } from "@/modules/domain.service";

@Roles("CAISSIER", "COMPTABLE", "ADMIN", "SUPER_ADMIN", "GESTIONNAIRE")
@Controller("caisse")
export class CaisseController {
  constructor(private readonly domain: DomainService) {}

  /** Dashboard stats — full pour COMPTABLE/ADMIN, perso pour CAISSIER */
  @Get("dashboard")
  dashboard(
    @Headers("x-tenant-id") tenantId: string,
    @Req() req: { user?: { sub?: string; role?: string } },
    @Query("periode") periode?: string,
  ) {
    return this.domain.caisseDashboard(tenantId, req.user?.role === 'CAISSIER' ? req.user?.sub : undefined, periode);
  }

  /** Liste des élèves actifs (pour formulaire d'encaissement) */
  @Get("eleves")
  eleves(
    @Headers("x-tenant-id") tenantId: string,
    @Query("search") search?: string,
  ) {
    return this.domain.caisseEleves(tenantId, search);
  }

  /** Détail des dettes d'un élève */
  @Get("eleves/:id/dettes")
  eleveDettes(
    @Headers("x-tenant-id") tenantId: string,
    @Param("id") id: string,
  ) {
    return this.domain.caisseEleveDettes(tenantId, id);
  }

  /** Liste des paiements avec filtres */
  @Get("paiements")
  paiements(
    @Headers("x-tenant-id") tenantId: string,
    @Query("statut") statut?: string,
    @Query("typePaiement") typePaiement?: string,
    @Query("eleveId") eleveId?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
    @Query("search") search?: string,
    @Query("page") page?: string,
    @Query("size") size?: string,
  ) {
    return this.domain.caissePaiements(tenantId, {
      statut, typePaiement, eleveId, dateFrom, dateTo, search,
      page: page ? Number(page) : 0,
      size: size ? Number(size) : 50,
    });
  }

  /** Historique (paiements validés uniquement, filtrés par date) */
  @Get("paiements/historique")
  historique(
    @Headers("x-tenant-id") tenantId: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
  ) {
    return this.domain.caisseHistorique(tenantId, dateFrom, dateTo);
  }

  /** Détail d'un paiement */
  @Get("paiements/:id")
  paiementById(@Param("id") id: string) {
    return this.domain.caissePaiementById(id);
  }

  /** Créer un encaissement */
  @Post("paiements")
  createPaiement(
    @Headers("x-tenant-id") tenantId: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    return this.domain.caisseCreatePaiement(tenantId, body, req.user?.sub);
  }

  /** Valider un paiement */
  @Post("paiements/:id/valider")
  valider(@Param("id") id: string, @Req() req: any) {
    return this.domain.caisseValiderPaiement(id, req.user?.sub);
  }

  /** Rejeter un paiement */
  @Post("paiements/:id/rejeter")
  rejeter(@Param("id") id: string, @Body() body: { motif?: string }) {
    return this.domain.caisseRejeterPaiement(id, body?.motif);
  }
}
