import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { Public } from "@/common/decorators/public.decorator";
import { SchoolService } from "@/modules/school/school.service";
import { DomainService } from "@/modules/domain.service";
import {
  CreateAnneeDto,
  CreateBatimentDto,
  CreateClasseDto,
  CreateCycleDto,
  CreateNiveauDto,
  CreateSalleDto,
} from "@/modules/school/dto/school.dto";

@Controller("v1")
export class V1Controller {
  constructor(
    private readonly schoolService: SchoolService,
    private readonly domain: DomainService,
  ) {}

  @Public()
  @Get("liens-bulletin/:token/consulter")
  bulletinPublic() {
    return { ok: true };
  }
  @Public()
  @Post("liens-bulletin/:token/verifier-otp")
  bulletinOtp() {
    return { ok: true };
  }
  @Public()
  @Get("liens-paiement/:token/detail")
  paiementDetail() {
    return { ok: true };
  }
  @Public()
  @Post("liens-paiement/:token/verifier-otp")
  paiementOtp() {
    return { ok: true };
  }
  @Public()
  @Post("liens-paiement/:token/payer")
  paiementPayer() {
    return { ok: true };
  }

  @Get("utilisateurs") utilisateurs(@Headers("x-tenant-id") tenantId: string) {
    return this.schoolService.listUsers(tenantId);
  }
  @Get("annees-academiques") annees(@Headers("x-tenant-id") tenantId: string) {
    return this.schoolService.listAnnees(tenantId);
  }
  @Post("annees-academiques") createAnnee(
    @Headers("x-tenant-id") tenantId: string,
    @Body() dto: CreateAnneeDto,
  ) {
    return this.schoolService.createAnnee(tenantId, dto);
  }
  @Get("cycles") cycles(@Headers("x-tenant-id") tenantId: string) {
    return this.schoolService.listCycles(tenantId);
  }
  @Post("cycles") createCycle(
    @Headers("x-tenant-id") tenantId: string,
    @Body() dto: CreateCycleDto,
  ) {
    return this.schoolService.createCycle(tenantId, dto);
  }
  @Get("niveaux") niveaux(@Headers("x-tenant-id") tenantId: string) {
    return this.schoolService.listNiveaux(tenantId);
  }
  @Post("niveaux") createNiveau(
    @Headers("x-tenant-id") tenantId: string,
    @Body() dto: CreateNiveauDto,
  ) {
    return this.schoolService.createNiveau(tenantId, dto);
  }
  @Get("batiments") batiments(@Headers("x-tenant-id") tenantId: string) {
    return this.schoolService.listBatiments(tenantId);
  }
  @Post("batiments") createBatiment(
    @Headers("x-tenant-id") tenantId: string,
    @Body() dto: CreateBatimentDto,
  ) {
    return this.schoolService.createBatiment(tenantId, dto);
  }
  @Get("salles") salles(@Headers("x-tenant-id") tenantId: string) {
    return this.schoolService.listSalles(tenantId);
  }
  @Post("salles") createSalle(
    @Headers("x-tenant-id") tenantId: string,
    @Body() dto: CreateSalleDto,
  ) {
    return this.schoolService.createSalle(tenantId, dto);
  }
  @Get("classes") classes(@Headers("x-tenant-id") tenantId: string) {
    return this.schoolService.listClasses(tenantId);
  }
  @Post("classes") createClasse(
    @Headers("x-tenant-id") tenantId: string,
    @Body() dto: CreateClasseDto,
  ) {
    return this.schoolService.createClasse(tenantId, dto);
  }
  @Get("enseignants") enseignants(@Headers("x-tenant-id") tenantId: string) {
    return this.schoolService.listTeachers(tenantId);
  }
  @Get("eleves") eleves(@Headers("x-tenant-id") tenantId: string) {
    return this.schoolService.listStudents(tenantId);
  }
  @Get("parents") parents(@Headers("x-tenant-id") tenantId: string) {
    return this.schoolService.listParents(tenantId);
  }
  @Get("cours") cours(@Headers("x-tenant-id") tenantId: string) {
    return this.domain.adminEmplois(tenantId);
  }
  @Get("stats/etablissement") etabStats(
    @Headers("x-tenant-id") tenantId: string,
  ) {
    return this.schoolService.etabStats(tenantId);
  }

  @Get("paiements") paiements(@Headers("x-tenant-id") tenantId: string) {
    return this.domain.v1Paiements(tenantId);
  }
  @Get("inscriptions") inscriptions(@Headers("x-tenant-id") tenantId: string) {
    return this.domain.v1Inscriptions(tenantId);
  }
  @Patch("inscriptions/:id/transferer") transfererInscription(
    @Param("id") id: string,
    @Body() body: { classeId: string },
  ) {
    return this.domain.v1TransferInscription(id, body.classeId);
  }
  @Post("liens-paiement/generer") genererLienPaiement() {
    return { generated: true };
  }

  @Get("absences-eleves") absencesEleves(
    @Headers("x-tenant-id") tenantId: string,
  ) {
    return this.domain.v1AbsencesEleves(tenantId);
  }
  @Post("absences-eleves/:id/approuver") approuverAbsenceEleve(
    @Param("id") id: string,
  ) {
    return this.domain.v1ApprouverAbsence(id);
  }
  @Post("absences-eleves/:id/rejeter") rejeterAbsenceEleve(
    @Param("id") id: string,
  ) {
    return this.domain.v1RejeterAbsence(id);
  }
  @Get("emplois-du-temps") emploisDuTemps(
    @Headers("x-tenant-id") tenantId: string,
  ) {
    return this.domain.v1Emplois(tenantId);
  }
  @Get("convocations") convocations(@Headers("x-tenant-id") tenantId: string) {
    return this.domain.v1Convocations(tenantId);
  }
  @Patch("convocations/:id/compte-rendu") compteRenduConvocation(
    @Param("id") id: string,
    @Body() body: { compteRendu: string },
  ) {
    return this.domain.v1CompteRenduConvocation(id, body.compteRendu);
  }
  @Post("liens-bulletin/generer") genererLienBulletin() {
    return { generated: true };
  }

  @Get("personnel") personnel(@Headers("x-tenant-id") tenantId: string) {
    return this.domain.v1Personnel(tenantId);
  }
  @Get("pointages") pointages(@Headers("x-tenant-id") tenantId: string) {
    return this.domain.v1Pointages(tenantId);
  }
  @Get("pointages/rapport") pointagesRapport(
    @Headers("x-tenant-id") tenantId: string,
  ) {
    return this.domain.v1Pointages(tenantId);
  }
  @Get("absences-personnel") absencesPersonnel(
    @Headers("x-tenant-id") tenantId: string,
  ) {
    return this.domain.v1AbsencesPersonnel(tenantId);
  }
  @Patch("absences-personnel/:id/valider") validerAbsencePersonnel(
    @Param("id") id: string,
  ) {
    return this.domain.v1ValiderAbsencePersonnel(id);
  }
  @Patch("absences-personnel/:id/refuser") refuserAbsencePersonnel(
    @Param("id") id: string,
  ) {
    return this.domain.v1RefuserAbsencePersonnel(id);
  }
}
