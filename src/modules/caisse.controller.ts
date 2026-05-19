import { Controller, Get, Headers, Param, Post } from "@nestjs/common";
import { Roles } from "@/common/decorators/roles.decorator";
import { DomainService } from "@/modules/domain.service";

@Roles("CAISSIER", "ADMIN")
@Controller("caisse")
export class CaisseController {
  constructor(private readonly domain: DomainService) {}

  @Get("paiements") paiements(@Headers("x-tenant-id") tenantId: string) {
    return this.domain.caissePaiements(tenantId);
  }
  @Get("paiements/historique") historiquePaiements(
    @Headers("x-tenant-id") tenantId: string,
  ) {
    return this.domain.caissePaiements(tenantId);
  }
  @Get("paiements/statut/:statut") paiementsByStatut(
    @Headers("x-tenant-id") tenantId: string,
  ) {
    return this.domain.caissePaiements(tenantId);
  }
  @Get("paiements/:id") paiementById(@Param("id") id: string) {
    return this.domain.caissePaiementById(id);
  }
  @Post("paiements/:id/valider") validerPaiement(@Param("id") id: string) {
    return this.domain.caisseValiderPaiement(id);
  }
}
