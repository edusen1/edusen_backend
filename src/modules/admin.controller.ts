import { Body, Controller, Get, Headers, Param } from "@nestjs/common";
import { Roles } from "@/common/decorators/roles.decorator";
import { DomainService } from "@/modules/domain.service";

@Roles("ADMIN", "SURVEILLANT", "CAISSIER")
@Controller("admin")
export class AdminController {
  constructor(private readonly domain: DomainService) {}

  @Get("users") users(@Headers("x-tenant-id") tenantId: string) {
    return this.domain.adminUsers(tenantId);
  }
  @Get("classes") classes(@Headers("x-tenant-id") tenantId: string) {
    return this.domain.adminEmplois(tenantId);
  }
  @Get("enseignants") enseignants(@Headers("x-tenant-id") tenantId: string) {
    return this.domain.adminTeachers(tenantId);
  }
  @Get("eleves") eleves(@Headers("x-tenant-id") tenantId: string) {
    return this.domain.adminStudents(tenantId);
  }
  @Get("parents") parents(@Headers("x-tenant-id") tenantId: string) {
    return this.domain.adminParents(tenantId);
  }
  @Get("matieres") matieres(@Headers("x-tenant-id") tenantId: string) {
    return this.domain.adminMatieres(tenantId);
  }
  @Get("matieres-classes") matieresClasses(
    @Headers("x-tenant-id") tenantId: string,
  ) {
    return this.domain.adminEmplois(tenantId);
  }
  @Get("calendrier-scolaire") calendrier() {
    return [];
  }
  @Get("reports/rapport-trimestre") rapport(
    @Headers("x-tenant-id") tenantId: string,
  ) {
    return this.domain.adminBulletins(tenantId);
  }
  @Get("reclamations") reclamations(@Headers("x-tenant-id") tenantId: string) {
    return this.domain.adminReclamations(tenantId);
  }
  @Get("paiements") paiements(@Headers("x-tenant-id") tenantId: string) {
    return this.domain.adminPaiements(tenantId);
  }
  @Get("absences-eleves") absencesEleves(
    @Headers("x-tenant-id") tenantId: string,
  ) {
    return this.domain.adminAbsencesEleves(tenantId);
  }
  @Get("notes") notes(@Headers("x-tenant-id") tenantId: string) {
    return this.domain.adminNotes(tenantId);
  }
  @Get("bulletins") bulletins(@Headers("x-tenant-id") tenantId: string) {
    return this.domain.adminBulletins(tenantId);
  }
  @Get("bulletins/:id/download") downloadBulletin(@Param("id") id: string) {
    return { id, type: "single" };
  }
  @Get("bulletins/download/by-classe") downloadByClasse() {
    return { type: "classe" };
  }
  @Get("bulletins/download/all") downloadAll() {
    return { type: "all" };
  }
  @Get("emplois-du-temps") emploisDuTemps(
    @Headers("x-tenant-id") tenantId: string,
  ) {
    return this.domain.adminEmplois(tenantId);
  }
}
