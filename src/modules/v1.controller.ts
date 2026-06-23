import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Public } from '@/common/decorators/public.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { JwtUser } from '@/common/types/auth.types';
import { LegacyCrudService } from '@/modules/legacy-crud.service';
import { AcademiqueConfigService } from '@/modules/configuration/academique-config.service';
import { PushNotificationService } from '@/modules/push-notification.service';

type QueryParams = Record<string, string | string[] | undefined>;
type Payload = Record<string, unknown>;

@Controller('v1')
export class V1Controller {
  constructor(
    private readonly crud: LegacyCrudService,
    private readonly academiqueConfig: AcademiqueConfigService,
    private readonly pushNotifications: PushNotificationService,
  ) {}

  private resolveTenantId(tenantId: string | undefined, user?: JwtUser): string | undefined {
    const headerTenantId = tenantId?.trim();
    const isUuid = !!headerTenantId
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(headerTenantId);

    return isUuid ? headerTenantId : user?.tenantId;
  }

  @Public()
  @Get('liens-bulletin/:token/consulter')
  consulterBulletin(@Param('token') token: string) {
    return this.crud.getLienBulletin(token);
  }

  @Public()
  @Post('liens-bulletin/:token/verifier-otp')
  verifierOtpBulletin(@Param('token') token: string) {
    return this.crud.getLienBulletin(token);
  }

  @Public()
  @Get('liens-paiement/:token/detail')
  detailPaiement(@Param('token') token: string) {
    return this.crud.getLienPaiement(token);
  }

  @Public()
  @Post('liens-paiement/:token/verifier-otp')
  verifierOtpPaiement(@Param('token') token: string) {
    return this.crud.getLienPaiement(token);
  }

  @Public()
  @Post('liens-paiement/:token/payer')
  payerLienPaiement(@Param('token') token: string) {
    return this.crud.payerLienPaiement(token);
  }

  @Get('stats/etablissement')
  stats(@Headers('x-tenant-id') tenantId: string | undefined, @CurrentUser() user?: JwtUser) {
    return this.crud.statsEtablissement(this.resolveTenantId(tenantId, user), user);
  }

  @Get('appbar/summary')
  appbarSummary(@Headers('x-tenant-id') tenantId: string | undefined, @CurrentUser() user?: JwtUser) {
    return this.crud.appbarSummary(this.resolveTenantId(tenantId, user), user);
  }

  @Get('appbar/notifications')
  appbarNotifications(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @CurrentUser() user?: JwtUser,
    @Query() query?: QueryParams,
  ) {
    return this.crud.appbarNotifications(this.resolveTenantId(tenantId, user), user, query);
  }

  @Get('appbar/messages')
  appbarMessages(@Headers('x-tenant-id') tenantId: string | undefined, @CurrentUser() user?: JwtUser) {
    return this.crud.appbarMessages(this.resolveTenantId(tenantId, user), user);
  }

  @Patch('appbar/notifications/lire-tout')
  appbarNotificationsReadAll(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.crud.markAllAppbarNotificationsRead(this.resolveTenantId(tenantId, user), user);
  }

  @Patch('appbar/notifications/:id/lire')
  appbarNotificationRead(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.crud.markAppbarNotificationRead(this.resolveTenantId(tenantId, user), id, user);
  }

  @Post('appbar/push-token')
  registerPushToken(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @CurrentUser() user: JwtUser | undefined,
    @Body() body: { token?: string; platform?: string; userAgent?: string },
  ) {
    return this.pushNotifications.registerToken(this.resolveTenantId(tenantId, user), user?.sub, body);
  }

  @Delete('appbar/push-token')
  unregisterPushToken(@CurrentUser() user: JwtUser | undefined, @Body() body: { token?: string }) {
    return this.pushNotifications.unregisterToken(body?.token, user?.sub);
  }

  @Get('annees-academiques/courante')
  anneeCourante(@Headers('x-tenant-id') tenantId?: string) {
    return this.crud.findCurrentAnnee(tenantId);
  }

  @Get('annees-academiques')
  anneesAcademiques(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Query() query: QueryParams,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.crud.findAll(
      this.crud.v1Config('annees-academiques'),
      this.resolveTenantId(tenantId, user),
      query,
    );
  }

  @Get('configuration/sections')
  configurationSections(@Headers('x-tenant-id') tenantId?: string, @CurrentUser() user?: JwtUser) {
    return this.academiqueConfig.getSections(this.resolveTenantId(tenantId, user)!);
  }

  @Post('annees-academiques/:id/activer')
  activerAnneePost(@Headers('x-tenant-id') tenantId: string | undefined, @Param('id') id: string) {
    return this.crud.activateAnnee(tenantId, id);
  }

  @Patch('annees-academiques/:id/activer')
  activerAnneePatch(@Headers('x-tenant-id') tenantId: string | undefined, @Param('id') id: string) {
    return this.crud.activateAnnee(tenantId, id);
  }

  @Get('batiments/:id/salles')
  sallesBatiment(@Headers('x-tenant-id') tenantId: string | undefined, @Param('id') id: string) {
    return this.crud.getBatimentSalles(tenantId, id);
  }

  @Patch('inscriptions/:id/transferer')
  transfererInscription(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @Body() body: Payload,
  ) {
    return this.crud.transferInscription(tenantId, id, String(body.classeId));
  }

  @Patch('inscriptions/:id/desactiver')
  desactiverInscription(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.crud.desactiverInscription(tenantId, id);
  }

  @Patch('inscriptions/:id/reactiver')
  reactiverInscription(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.crud.reactiverInscription(tenantId, id);
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

  @Patch('convocations/:id/compte-rendu')
  compteRenduConvocation(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @Body() body: Payload,
  ) {
    return this.crud.compteRenduConvocation(tenantId, id, String(body.compteRendu ?? ''));
  }

  @Patch('absences-personnel/:id/valider')
  @Post('absences-personnel/:id/valider')
  validerAbsencePersonnel(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.crud.validateAbsencePersonnel(this.resolveTenantId(tenantId, user), id, user?.sub);
  }

  @Patch('absences-personnel/:id/refuser')
  @Post('absences-personnel/:id/rejeter')
  @Post('absences-personnel/:id/refuser')
  refuserAbsencePersonnel(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.crud.refuseAbsencePersonnel(this.resolveTenantId(tenantId, user), id, body.motifRefus, user?.sub);
  }

  @Get('pointages/rapport')
  rapportPointages(@Headers('x-tenant-id') tenantId: string | undefined, @Query() query: QueryParams) {
    return this.crud.rapportPointages(tenantId, query);
  }

  @Post('utilisateurs/:id/reinitialiser-mdp')
  reinitialiserMdp(@Headers('x-tenant-id') tenantId: string | undefined, @Param('id') id: string) {
    return this.crud.resetPassword(tenantId, id);
  }

  @Post('utilisateurs/:id/cycles')
  assignerCycles(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @Body() body: Payload,
  ) {
    const cycles = Array.isArray(body.cycleIds) ? body.cycleIds.map(String) : [];
    return this.crud.assignCycles(tenantId, id, cycles);
  }

  @Delete('utilisateurs/:id/cycles/:cycleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  retirerCycle(@Param('id') id: string, @Param('cycleId') cycleId: string) {
    return this.crud.removeCycle(id, cycleId);
  }

  @Post('liens-paiement/generer')
  genererLienPaiement(@Headers('x-tenant-id') tenantId: string | undefined, @Body() body: Payload) {
    return this.crud.createLienPaiement(tenantId, body);
  }

  @Post('liens-bulletin/generer')
  genererLienBulletin(@Headers('x-tenant-id') tenantId: string | undefined, @Body() body: Payload) {
    return this.crud.createLienBulletin(tenantId, body);
  }

  @Post('bulletins/generer')
  genererBulletins(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.crud.generateBulletinsForClasse(tenantId, body, user?.sub);
  }

  @Get('bulletins/:id/download')
  telechargerBulletin(@Headers('x-tenant-id') tenantId: string | undefined, @Param('id') id: string) {
    return this.crud.getBulletinDownload(tenantId, id);
  }

  @Get('inscriptions/suggestion/:eleveId')
  inscriptionSuggestion(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('eleveId') eleveId: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.crud.getInscriptionSuggestion(this.resolveTenantId(tenantId, user), eleveId);
  }

  @Get('demandes-passage')
  getDemandesPassage(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Query() query: QueryParams,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.crud.getDemandesPassage(this.resolveTenantId(tenantId, user), query);
  }

  @Post('demandes-passage')
  createDemandePassage(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.crud.createDemandePassage(this.resolveTenantId(tenantId, user), body, user?.sub);
  }

  @Patch('demandes-passage/:id/approuver')
  @Post('demandes-passage/:id/approuver')
  approuverDemandePassage(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.crud.approuverDemandePassage(this.resolveTenantId(tenantId, user), id, user?.sub);
  }

  @Patch('demandes-passage/:id/rejeter')
  @Post('demandes-passage/:id/rejeter')
  rejeterDemandePassage(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.crud.rejeterDemandePassage(this.resolveTenantId(tenantId, user), id, body, user?.sub);
  }

  @Get(':resource')
  findAll(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('resource') resource: string,
    @Query() query: QueryParams,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.crud.findAll(this.crud.v1Config(resource), this.resolveTenantId(tenantId, user), query);
  }

  @Get(':resource/:id')
  findById(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('resource') resource: string,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.crud.findOne(this.crud.v1Config(resource), this.resolveTenantId(tenantId, user), id);
  }

  @Post(':resource')
  create(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('resource') resource: string,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.crud.create(this.crud.v1Config(resource), this.resolveTenantId(tenantId, user), body, user);
  }

  @Put(':resource/:id')
  @Patch(':resource/:id')
  update(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('resource') resource: string,
    @Param('id') id: string,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.crud.update(this.crud.v1Config(resource), this.resolveTenantId(tenantId, user), id, body);
  }

  @Delete(':resource/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('resource') resource: string,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.crud.delete(this.crud.v1Config(resource), this.resolveTenantId(tenantId, user), id);
  }
}
