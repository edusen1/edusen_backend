import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Patch,
} from '@nestjs/common';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { JwtUser } from '@/common/types/auth.types';
import { LegacyCrudService } from '@/modules/legacy-crud.service';
import { EcoleConfigService } from '@/modules/configuration/ecole-config.service';
import { UpdateEcoleConfigDto } from '@/modules/configuration/dto/update-ecole-config.dto';
import { UpdateApparenceDto } from '@/modules/configuration/dto/update-apparence.dto';
import { AcademiqueConfigService } from '@/modules/configuration/academique-config.service';
import { SaveFraisDto } from '@/modules/configuration/dto/save-frais.dto';
import { WhatsappService } from '@/modules/whatsapp/whatsapp.service';
import { UpdateWhatsappFeaturesDto } from '@/modules/whatsapp/dto/update-whatsapp-features.dto';
import { ClasseService } from '@/modules/classes/classe.service';
import { CreateClasseDto } from '@/modules/classes/dto/create-classe.dto';
import { UpdateClasseDto } from '@/modules/classes/dto/update-classe.dto';
import { EmploiDuTempsService } from '@/modules/v1/emploi-du-temps/emploi-du-temps.service';
import { BulletinService } from '@/modules/v1/bulletin/bulletin.service';
import { DomainService } from '@/modules/domain.service';

type QueryParams = Record<string, string | string[] | undefined>;
type Payload = Record<string, unknown>;

@Roles('ADMIN', 'SURVEILLANT', 'CAISSIER', 'RH')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly crud: LegacyCrudService,
    private readonly ecoleConfig: EcoleConfigService,
    private readonly academiqueConfig: AcademiqueConfigService,
    private readonly whatsapp: WhatsappService,
    private readonly classeService: ClasseService,
    private readonly emploiService: EmploiDuTempsService,
    private readonly bulletinService: BulletinService,
    private readonly domain: DomainService,
  ) {}

  private resolveTenantId(tenantId: string | undefined, user?: JwtUser) {
    return this.crud.resolveTenantId(tenantId, user);
  }

  // ----------------------------------------------------------------
  // Classes
  // ----------------------------------------------------------------

  @Get('classes')
  getClasses(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Query('anneeId') anneeId?: string,
    @Query('niveauId') niveauId?: string,
    @Query('cycleId') cycleId?: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.resolveTenantId(tenantId, user).then((tid) => this.classeService.getClasses(tid!, anneeId, niveauId, cycleId));
  }

  @Post('classes')
  createClasse(@Headers('x-tenant-id') tenantId: string | undefined, @Body() dto: CreateClasseDto) {
    return this.classeService.createClasse(tenantId!, dto);
  }

  @Get('classes/professeurs')
  getProfesseurs(@Headers('x-tenant-id') tenantId: string | undefined, @CurrentUser() user?: JwtUser) {
    return this.resolveTenantId(tenantId, user).then((tid) => this.classeService.getProfesseurs(tid!));
  }

  @Get('classes/:id/eleves')
  getClasseEleves(@Headers('x-tenant-id') tenantId: string | undefined, @Param('id') id: string, @CurrentUser() user?: JwtUser) {
    return this.resolveTenantId(tenantId, user).then((tid) => this.classeService.getClasseEleves(tid!, id));
  }

  @Get('classes/:id/eleves/:eleveId/notes')
  getClasseEleveNotes(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @Param('eleveId') eleveId: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.resolveTenantId(tenantId, user).then((tid) => this.classeService.getEleveNotesForClasse(tid!, id, eleveId));
  }

  @Get('classes/:id')
  getClasse(@Headers('x-tenant-id') tenantId: string | undefined, @Param('id') id: string, @CurrentUser() user?: JwtUser) {
    return this.resolveTenantId(tenantId, user).then((tid) => this.classeService.getClasse(tid!, id));
  }

  @Put('classes/:id')
  updateClasse(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateClasseDto,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.resolveTenantId(tenantId, user).then((tid) => this.classeService.updateClasse(tid!, id, dto));
  }

  @Delete('classes/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteClasse(@Headers('x-tenant-id') tenantId: string | undefined, @Param('id') id: string, @CurrentUser() user?: JwtUser) {
    return this.resolveTenantId(tenantId, user).then((tid) => this.classeService.deleteClasse(tid!, id));
  }

  @Post('classes/:id/stagiaires')
  addStagiaire(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') classeId: string,
    @Body('stagiaireId') stagiaireId: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.resolveTenantId(tenantId, user).then((tid) => this.classeService.addStagiaire(tid!, classeId, stagiaireId));
  }

  @Roles('ADMIN')
  @Post('matieres/avec-affectations')
  createMatiereWithAssignments(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.resolveTenantId(tenantId, user).then((tid) =>
      this.crud.createMatiereWithAssignments(tid!, body),
    );
  }

  @Delete('classes/:id/stagiaires/:stagiaireId')
  removeStagiaire(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') classeId: string,
    @Param('stagiaireId') stagiaireId: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.resolveTenantId(tenantId, user).then((tid) => this.classeService.removeStagiaire(tid!, classeId, stagiaireId));
  }

  // ----------------------------------------------------------------
  // Emplois du temps
  // ----------------------------------------------------------------

  @Get('emplois-du-temps')
  getEmplois(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Query('classeId') classeId?: string,
    @Query('enseignantId') enseignantId?: string,
  ) {
    return this.emploiService.findAll(tenantId!, classeId, enseignantId);
  }

  @Post('emplois-du-temps')
  createEmploi(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Body() body: Payload,
  ) {
    return this.emploiService.create(tenantId!, body as any);
  }

  @Get('emplois-du-temps/classe/:classeId')
  getEmploiParClasse(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('classeId') classeId: string,
    @Query('anneeScolaire') anneeScolaire?: string,
  ) {
    return this.emploiService.findByClasse(tenantId!, classeId, anneeScolaire);
  }

  @Post('emplois-du-temps/classe/:classeId')
  createEmploiParClasse(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('classeId') classeId: string,
    @Body() body: Payload,
  ) {
    return this.emploiService.create(tenantId!, { ...(body as any), classeId });
  }

  @Post('emplois-du-temps/classe/:classeId/publier')
  publierEmploiParClasse(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('classeId') classeId: string,
    @Query('anneeScolaire') anneeScolaire?: string,
  ) {
    return this.emploiService.publier(tenantId!, classeId, anneeScolaire ?? '');
  }

  @Get('emplois-du-temps/:id')
  getEmploi(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.emploiService.findOne(tenantId!, id);
  }

  @Put('emplois-du-temps/:id')
  @Patch('emplois-du-temps/:id')
  updateEmploi(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @Body() body: Payload,
  ) {
    return this.emploiService.update(tenantId!, id, body as any);
  }

  @Delete('emplois-du-temps/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteEmploi(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.emploiService.delete(tenantId!, id);
  }

  @Get('reports/rapport-trimestre')
  rapportTrimestre(@Headers('x-tenant-id') tenantId: string | undefined, @Query() query: QueryParams) {
    return this.crud.findAll(this.crud.adminConfig('bulletins'), tenantId, query);
  }

  @Get('bulletins/download/by-classe')
  downloadByClasse(@Query() query: QueryParams) {
    return { type: 'classe', ...query };
  }

  @Get('bulletins/download/all')
  downloadAll(@Query() query: QueryParams) {
    return { type: 'all', ...query };
  }

  @Get('bulletins/:id/download')
  downloadBulletin(@Headers('x-tenant-id') tenantId: string | undefined, @Param('id') id: string) {
    return this.crud.getBulletinDownload(tenantId, id);
  }

  @Post('bulletins/generer')
  genererBulletins(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.crud.generateBulletinsForClasse(tenantId, body, user?.sub);
  }

  @Post('bulletins/:id/valider')
  validerBulletin(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.bulletinService.valider(tenantId!, id, user?.sub ?? 'admin');
  }

  @Post('bulletins/:id/publier')
  publierBulletin(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.bulletinService.publier(tenantId!, id, user?.sub ?? 'admin');
  }

  @Post('bulletins/:id/duplicata')
  duplicataBulletin(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.bulletinService.genererDuplicata(tenantId!, id, user?.sub ?? 'admin');
  }

  @Post('absences-eleves/:id/approuver')
  approuverAbsenceEleve(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.crud.approveAbsenceEleve(tenantId, id, user?.sub);
  }

  @Post('absences-eleves/:id/rejeter')
  rejeterAbsenceEleve(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.crud.rejectAbsenceEleve(tenantId, id, user?.sub);
  }

  // ----------------------------------------------------------------
  // Configuration école — ADMIN uniquement
  // ----------------------------------------------------------------

  @Roles('ADMIN')
  @Get('configuration/ecole')
  getEcoleConfig(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.ecoleConfig.getEcoleConfig(tid!);
  }

  @Roles('ADMIN')
  @Put('configuration/ecole')
  updateEcoleConfig(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Body() dto: UpdateEcoleConfigDto,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.ecoleConfig.updateEcoleConfig(tid!, dto);
  }

  @Roles('ADMIN')
  @Get('configuration/apparence')
  getApparence(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.ecoleConfig.getApparence(tid!);
  }

  @Roles('ADMIN')
  @Put('configuration/apparence')
  updateApparence(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Body() dto: UpdateApparenceDto,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.ecoleConfig.updateApparence(tid!, dto);
  }

  // ----------------------------------------------------------------
  // Configuration académique — ADMIN uniquement
  // ----------------------------------------------------------------

  @Roles('ADMIN')
  @Get('configuration/annees-academiques')
  getAnnees(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.academiqueConfig.getAnnees(tid!);
  }

  @Roles('ADMIN')
  @Get('configuration/annees-academiques/courante')
  getAnneeCourante(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.academiqueConfig.getAnneeCourante(tid!);
  }

  @Roles('ADMIN')
  @Post('configuration/annees-academiques')
  createAnnee(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.academiqueConfig.createAnnee(tid!, {
      libelle: String(body.libelle ?? ''),
      active: Boolean(body.active ?? body.estCourante ?? false),
    });
  }

  @Roles('ADMIN')
  @Patch('configuration/annees-academiques/:id/activer')
  activerAnnee(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.academiqueConfig.activateAnnee(tid!, id);
  }

  @Roles('ADMIN')
  @Get('configuration/sections')
  getSections(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.academiqueConfig.getSections(tid!);
  }

  @Roles('ADMIN')
  @Post('configuration/sections')
  createSection(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.academiqueConfig.createSection(tid!, String(body.nom ?? body.libelle ?? ''));
  }

  @Roles('ADMIN')
  @Patch('configuration/sections/:id')
  updateSection(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.academiqueConfig.updateSection(tid!, id, {
      nom: body.nom !== undefined || body.libelle !== undefined ? String(body.nom ?? body.libelle) : undefined,
      actif: body.actif !== undefined ? Boolean(body.actif) : undefined,
    });
  }

  @Roles('ADMIN')
  @Get('configuration/niveaux')
  getNiveaux(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Query('sectionId') sectionId: string | undefined,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.academiqueConfig.getNiveaux(tid!, sectionId);
  }

  @Roles('ADMIN')
  @Post('configuration/niveaux')
  createNiveau(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.academiqueConfig.createNiveau(tid!, {
      sectionId: String(body.sectionId ?? ''),
      nom: String(body.nom ?? body.libelle ?? ''),
      ordre: body.ordre !== undefined ? Number(body.ordre) : undefined,
      moyennePassage: body.moyennePassage !== undefined ? Number(body.moyennePassage) : undefined,
    });
  }

  @Roles('ADMIN')
  @Patch('configuration/niveaux/:id')
  updateNiveau(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.academiqueConfig.updateNiveau(tid!, id, {
      nom: body.nom !== undefined || body.libelle !== undefined ? String(body.nom ?? body.libelle) : undefined,
      ordre: body.ordre !== undefined ? Number(body.ordre) : undefined,
      moyennePassage: body.moyennePassage !== undefined ? Number(body.moyennePassage) : undefined,
      actif: body.actif !== undefined ? Boolean(body.actif) : undefined,
    });
  }

  @Roles('ADMIN')
  @Get('configuration/frais')
  getFrais(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.academiqueConfig.getFrais(tid!);
  }

  @Roles('ADMIN')
  @Put('configuration/frais')
  saveFrais(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Body() dto: SaveFraisDto,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.academiqueConfig.saveFrais(tid!, dto);
  }

  @Roles('ADMIN')
  @Get('configuration/calendrier-scolaire')
  getCalendrierScolaire(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Query('sectionId') sectionId: string | undefined,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.academiqueConfig.getCalendrier(tid!, sectionId);
  }

  @Roles('ADMIN')
  @Post('configuration/calendrier-scolaire')
  createCalendrierScolaire(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.academiqueConfig.createCalendrier(tid!, {
      sectionId: body.sectionId ? String(body.sectionId) : null,
      titre: String(body.titre ?? ''),
      description: body.description !== undefined ? String(body.description) : null,
      dateDebut: String(body.dateDebut ?? ''),
      dateFin: body.dateFin ? String(body.dateFin) : null,
      type: body.type ? String(body.type) : 'AUTRE',
    });
  }

  @Roles('ADMIN')
  @Patch('configuration/calendrier-scolaire/:id')
  updateCalendrierScolaire(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.academiqueConfig.updateCalendrier(tid!, id, {
      sectionId: body.sectionId !== undefined ? (body.sectionId ? String(body.sectionId) : null) : undefined,
      titre: body.titre !== undefined ? String(body.titre) : undefined,
      description: body.description !== undefined ? String(body.description) : undefined,
      dateDebut: body.dateDebut !== undefined ? String(body.dateDebut) : undefined,
      dateFin: body.dateFin !== undefined ? (body.dateFin ? String(body.dateFin) : null) : undefined,
      type: body.type !== undefined ? String(body.type) : undefined,
    });
  }

  @Roles('ADMIN')
  @Delete('configuration/calendrier-scolaire/:id')
  deleteCalendrierScolaire(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.academiqueConfig.deleteCalendrier(tid!, id);
  }

  // ----------------------------------------------------------------
  // WhatsApp — ADMIN uniquement
  // ----------------------------------------------------------------

  @Roles('ADMIN')
  @Get('whatsapp/status')
  getWhatsappStatus(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.whatsapp.getStatus(tid!);
  }

  @Roles('ADMIN')
  @Get('whatsapp/qr-code')
  getWhatsappQr(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.whatsapp.getQrCode(tid!);
  }

  @Roles('ADMIN')
  @Delete('whatsapp/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logoutWhatsapp(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.whatsapp.logout(tid!);
  }

  @Roles('ADMIN')
  @Put('whatsapp/features')
  updateWhatsappFeatures(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Body() dto: UpdateWhatsappFeaturesDto,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.whatsapp.updateFeatures(tid!, dto);
  }

  @Roles('ADMIN')
  @Post('whatsapp/test')
  testWhatsapp(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    const phone = String(body.phone ?? '');
    return this.whatsapp.sendMessage(tid!, phone, 'Message de test Noura School ✅');
  }

  @Roles('ADMIN')
  @Get('whatsapp/outbox')
  getWhatsappOutbox(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.whatsapp.getOutbox(tid!);
  }

  @Get('parents/:id/enfants')
  parentChildren(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.crud.adminParentChildren(tenantId, id);
  }

  @Get('eleves/:id/parcours')
  eleveParcours(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.crud.adminEleveParcours(tenantId, id);
  }

  // ----------------------------------------------------------------
  // Paiements — alias admin vers la caisse
  // ----------------------------------------------------------------

  @Get('paiements')
  getPaiements(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Query('statut') statut?: string,
    @Query('typePaiement') typePaiement?: string,
    @Query('eleveId') eleveId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
  ) {
    return this.domain.caissePaiements(tenantId!, {
      statut,
      typePaiement,
      eleveId,
      dateFrom,
      dateTo,
      search,
      page: page ? Number(page) : 0,
      size: size ? Number(size) : 50,
    });
  }

  @Get('paiements/:id')
  getPaiementById(@Param('id') id: string) {
    return this.domain.caissePaiementById(id);
  }

  @Post('paiements')
  createPaiement(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.domain.caisseCreatePaiement(tenantId!, body as any, user?.sub);
  }

  @Post('paiements/:id/valider')
  validerPaiement(@Param('id') id: string, @CurrentUser() user?: JwtUser) {
    return this.domain.caisseValiderPaiement(id, user?.sub);
  }

  @Post('paiements/:id/rejeter')
  rejeterPaiement(@Param('id') id: string, @Body() body: { motif?: string }) {
    return this.domain.caisseRejeterPaiement(id, body?.motif);
  }

  // ----------------------------------------------------------------
  // Réclamations — actions spécifiques
  // ----------------------------------------------------------------

  @Put('reclamations/:id/statut')
  updateReclamationStatut(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @Body() body: { statut: string },
  ) {
    return this.crud.update(
      this.crud.adminConfig('reclamations'),
      tenantId,
      id,
      { statut: body.statut },
    );
  }

  @Post('reclamations/:id/repondre')
  repondreReclamation(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @Body() body: { message: string; statut?: string },
  ) {
    const updateData: Payload = { reponse: body.message };
    if (body.statut) updateData['statut'] = body.statut;
    return this.crud.update(
      this.crud.adminConfig('reclamations'),
      tenantId,
      id,
      updateData,
    );
  }

  // ----------------------------------------------------------------
  // Routes génériques (doivent rester après les routes spécifiques)
  // ----------------------------------------------------------------

  @Get(':resource')
  findAll(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('resource') resource: string,
    @Query() query: QueryParams,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.resolveTenantId(tenantId, user).then((tid) => this.crud.findAll(this.crud.adminConfig(resource), tid, query));
  }

  @Get(':resource/:id')
  findById(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('resource') resource: string,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.resolveTenantId(tenantId, user).then((tid) => this.crud.findOne(this.crud.adminConfig(resource), tid, id));
  }

  @Post(':resource')
  create(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('resource') resource: string,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.resolveTenantId(tenantId, user).then((tid) => this.crud.create(this.crud.adminConfig(resource), tid, body, user?.sub));
  }

  @Put(':resource/:id')
  update(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('resource') resource: string,
    @Param('id') id: string,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.resolveTenantId(tenantId, user).then((tid) => this.crud.update(this.crud.adminConfig(resource), tid, id, body));
  }

  @Delete(':resource/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('resource') resource: string,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.resolveTenantId(tenantId, user).then((tid) => this.crud.delete(this.crud.adminConfig(resource), tid, id));
  }
}
