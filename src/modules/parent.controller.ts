import { Controller, Get, Headers, Param } from "@nestjs/common";
import { Roles } from "@/common/decorators/roles.decorator";
import { DomainService } from "@/modules/domain.service";

@Roles("PARENT")
@Controller("parent")
export class ParentController {
  constructor(private readonly domain: DomainService) {}

  @Get("profil") profil() {
    return { message: "profil parent connect�" };
  }
  @Get("enfants") enfants() {
    return [];
  }
  @Get("enfants/:eleveId/profil") enfantProfil(
    @Param("eleveId") eleveId: string,
  ) {
    return { eleveId };
  }
  @Get("enfants/:eleveId/notes") enfantNotes(
    @Headers("x-tenant-id") tenantId: string,
    @Param("eleveId") eleveId: string,
  ) {
    return this.domain.studentNotes(tenantId, eleveId);
  }
  @Get("enfants/:eleveId/bulletins") enfantBulletins(
    @Headers("x-tenant-id") tenantId: string,
    @Param("eleveId") eleveId: string,
  ) {
    return this.domain.studentBulletins(tenantId, eleveId);
  }
  @Get("enfants/:eleveId/emploi-du-temps") enfantEmploiDuTemps(
    @Headers("x-tenant-id") tenantId: string,
  ) {
    return this.domain.v1Emplois(tenantId);
  }
  @Get("enfants/:eleveId/absences") enfantAbsences(
    @Headers("x-tenant-id") tenantId: string,
    @Param("eleveId") eleveId: string,
  ) {
    return this.domain.studentAbsences(tenantId, eleveId);
  }
  @Get("paiements") paiements(@Headers("x-tenant-id") tenantId: string) {
    return this.domain.parentPaiements(tenantId);
  }
  @Get("notifications") notifications() {
    return [];
  }
}
