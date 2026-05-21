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
  ) {}

  // ----------------------------------------------------------------
  // Classes
  // ----------------------------------------------------------------

  @Get('classes')
  getClasses(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Query('anneeId') anneeId?: string,
    @Query('niveauId') niveauId?: string,
    @Query('cycleId') cycleId?: string,
  ) {
    return this.classeService.getClasses(tenantId!, anneeId, niveauId, cycleId);
  }

  @Post('classes')
  createClasse(@Headers('x-tenant-id') tenantId: string | undefined, @Body() dto: CreateClasseDto) {
    return this.classeService.createClasse(tenantId!, dto);
  }

  @Get('classes/enseignants')
  getEnseignants(@Headers('x-tenant-id') tenantId: string | undefined) {
    return this.classeService.getEnseignants(tenantId!);
  }

  @Get('classes/:id')
  getClasse(@Headers('x-tenant-id') tenantId: string | undefined, @Param('id') id: string) {
    return this.classeService.getClasse(tenantId!, id);
  }

  @Put('classes/:id')
  updateClasse(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateClasseDto,
  ) {
    return this.classeService.updateClasse(tenantId!, id, dto);
  }

  @Delete('classes/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteClasse(@Headers('x-tenant-id') tenantId: string | undefined, @Param('id') id: string) {
    return this.classeService.deleteClasse(tenantId!, id);
  }

  @Post('classes/:id/stagiaires')
  addStagiaire(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') classeId: string,
    @Body('stagiaireId') stagiaireId: string,
  ) {
    return this.classeService.addStagiaire(tenantId!, classeId, stagiaireId);
  }

  @Delete('classes/:id/stagiaires/:stagiaireId')
  removeStagiaire(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') classeId: string,
    @Param('stagiaireId') stagiaireId: string,
  ) {
    return this.classeService.removeStagiaire(tenantId!, classeId, stagiaireId);
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
    return this.whatsapp
      .sendMessage(tid!, phone, 'Message de test Noura School ✅')
      .then(() => ({ sent: true, messageId: `test-${Date.now()}` }));
  }

  // ----------------------------------------------------------------
  // Routes génériques (doivent rester après les routes spécifiques)
  // ----------------------------------------------------------------

  @Get(':resource')
  findAll(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('resource') resource: string,
    @Query() query: QueryParams,
  ) {
    return this.crud.findAll(this.crud.adminConfig(resource), tenantId, query);
  }

  @Get(':resource/:id')
  findById(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('resource') resource: string,
    @Param('id') id: string,
  ) {
    return this.crud.findOne(this.crud.adminConfig(resource), tenantId, id);
  }

  @Post(':resource')
  create(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('resource') resource: string,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.crud.create(this.crud.adminConfig(resource), tenantId, body, user?.sub);
  }

  @Put(':resource/:id')
  update(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('resource') resource: string,
    @Param('id') id: string,
    @Body() body: Payload,
  ) {
    return this.crud.update(this.crud.adminConfig(resource), tenantId, id, body);
  }

  @Delete(':resource/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('resource') resource: string,
    @Param('id') id: string,
  ) {
    return this.crud.delete(this.crud.adminConfig(resource), tenantId, id);
  }
}
