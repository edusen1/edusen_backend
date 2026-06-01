import { Body, Controller, Get, Headers, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { JwtUser } from '@/common/types/auth.types';
import { DomainService } from '@/modules/domain.service';
import { LegacyCrudService } from '@/modules/legacy-crud.service';
import { ClasseService } from '@/modules/classes/classe.service';

type QueryParams = Record<string, string | string[] | undefined>;
type Payload = Record<string, unknown>;

@Roles('ENSEIGNANT')
@Controller('professeur')
export class TeacherController {
  constructor(
    private readonly domain: DomainService,
    private readonly crud: LegacyCrudService,
    private readonly classeService: ClasseService,
  ) {}

  @Get('profil')
  profil(@CurrentUser() user?: JwtUser) {
    return user ? this.domain.teacherProfil(user.sub) : null;
  }

  @Get('classes-matieres')
  classesMatieres(@Headers('x-tenant-id') tenantId: string, @CurrentUser() user?: JwtUser) {
    return this.crud.findAll(this.crud.v1Config('matieres-classes'), tenantId, {
      enseignantId: user?.sub,
    });
  }

  @Get('mes-classes')
  mesClasses(@Headers('x-tenant-id') tenantId: string, @CurrentUser() user?: JwtUser) {
    return this.classeService.getTeacherClasses(tenantId, user?.sub ?? '');
  }

  @Get('classes/:id/eleves')
  async classeEleves(
    @Headers('x-tenant-id') tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    await this.classeService.assertTeacherClasseAccess(tenantId, user?.sub ?? '', id);
    return this.classeService.getClasseEleves(tenantId, id);
  }

  @Get('classes/:id/eleves/:eleveId/notes')
  async classeEleveNotes(
    @Headers('x-tenant-id') tenantId: string,
    @Param('id') id: string,
    @Param('eleveId') eleveId: string,
    @CurrentUser() user?: JwtUser,
  ) {
    await this.classeService.assertTeacherClasseAccess(tenantId, user?.sub ?? '', id);
    return this.classeService.getEleveNotesForClasse(tenantId, id, eleveId);
  }

  @Post('classes/:id/eleves/:eleveId/notes')
  async createClasseNote(
    @Headers('x-tenant-id') tenantId: string,
    @Param('id') id: string,
    @Param('eleveId') eleveId: string,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    await this.classeService.assertTeacherClasseAccess(tenantId, user?.sub ?? '', id);
    await this.classeService.assertTeacherMatiereAccess(tenantId, user?.sub ?? '', id, String(body.matiereId ?? ''));
    return this.crud.create(this.crud.v1Config('notes'), tenantId, { ...body, eleveId }, user?.sub);
  }

  @Post('classes/:id/eleves/:eleveId/comportement')
  async saveComportement(
    @Headers('x-tenant-id') tenantId: string,
    @Param('id') id: string,
    @Param('eleveId') eleveId: string,
    @Body() body: { trimestre?: string; appreciation?: string },
    @CurrentUser() user?: JwtUser,
  ) {
    await this.classeService.assertTeacherClasseAccess(tenantId, user?.sub ?? '', id);
    return this.classeService.saveEleveComportement(tenantId, id, eleveId, body);
  }

  @Get('conseil-classe-actif')
  async conseilClasseActif(@Headers('x-tenant-id') tenantId: string) {
    const today = new Date();
    const evenements = await this.classeService.getConseilClasseActif(tenantId, today);
    return { actif: evenements.length > 0, evenements };
  }

  @Get('classes/:id/eleves/:eleveId/historique')
  async eleveHistorique(
    @Headers('x-tenant-id') tenantId: string,
    @Param('id') id: string,
    @Param('eleveId') eleveId: string,
    @CurrentUser() user?: JwtUser,
  ) {
    await this.classeService.assertTeacherClasseAccess(tenantId, user?.sub ?? '', id);
    return this.classeService.getEleveHistorique(tenantId, id, eleveId);
  }

  @Get('classes/:id/cours')
  async classeCours(
    @Headers('x-tenant-id') tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    await this.classeService.assertTeacherClasseAccess(tenantId, user?.sub ?? '', id);
    return this.classeService.getClasseCours(tenantId, id, user?.sub ?? '');
  }

  @Get('classes/:id/appels')
  async listClasseAppels(
    @Headers('x-tenant-id') tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    await this.classeService.assertTeacherClasseAccess(tenantId, user?.sub ?? '', id);
    return this.classeService.getClasseAppels(tenantId, id);
  }

  @Patch('classes/:id/appels/:appelId')
  async updateClasseAppel(
    @Headers('x-tenant-id') tenantId: string,
    @Param('id') id: string,
    @Param('appelId') appelId: string,
    @Body() body: { lignes: { eleveId: string; statut: string }[] },
    @CurrentUser() user?: JwtUser,
  ) {
    await this.classeService.assertTeacherClasseAccess(tenantId, user?.sub ?? '', id);
    return this.classeService.updateAppelLignes(tenantId, id, appelId, body.lignes ?? []);
  }

  @Post('classes/:id/appels')
  async createClasseAppel(
    @Headers('x-tenant-id') tenantId: string,
    @Param('id') id: string,
    @Body() body: { coursId?: string; session?: string; dateCours: string; heureDebut?: string; absents?: string[] },
    @CurrentUser() user?: JwtUser,
  ) {
    await this.classeService.assertTeacherClasseAccess(tenantId, user?.sub ?? '', id);
    return this.classeService.createAppelWithLignes(tenantId, id, user?.sub ?? '', {
      coursId: body.coursId ?? null,
      session: body.session ?? null,
      dateCours: body.dateCours,
      heureDebut: body.heureDebut,
      absents: body.absents ?? [],
    });
  }

  @Get('emploi-du-temps')
  emploiDuTemps(@Headers('x-tenant-id') tenantId: string, @CurrentUser() user?: JwtUser) {
    return this.classeService.getTeacherEmploiDuTemps(tenantId, user?.sub ?? '');
  }

  @Get('notes')
  notes(@Headers('x-tenant-id') tenantId: string, @Query() query: QueryParams) {
    return this.crud.findAll(this.crud.v1Config('notes'), tenantId, query);
  }

  @Post('notes')
  createNote(
    @Headers('x-tenant-id') tenantId: string,
    @Body() body: { eleveId: string; coursId?: string; matiereId?: string; valeur?: number; note?: number; typeEval?: string },
  ) {
    return this.domain.teacherCreateNote(tenantId, {
      eleveId: body.eleveId,
      coursId: body.coursId,
      matiereId: body.matiereId,
      valeur: body.note ?? body.valeur ?? 0,
      typeEval: body.typeEval,
    });
  }

  @Put('notes/:noteId')
  updateNote(@Param('noteId') noteId: string, @Body() body: { valeur?: number; note?: number }) {
    return this.domain.teacherUpdateNote(noteId, body.note ?? body.valeur ?? 0);
  }

  @Get('absences')
  absences(@Headers('x-tenant-id') tenantId: string, @CurrentUser() user?: JwtUser) {
    return this.classeService.getTeacherAbsences(tenantId, user?.sub ?? '');
  }

  @Post('absences')
  createAbsence(@Headers('x-tenant-id') tenantId: string, @Body() body: Payload, @CurrentUser() user?: JwtUser) {
    return this.classeService.createTeacherAbsence(tenantId, user?.sub ?? '', body as any);
  }

  @Get('bulletins')
  bulletins(@Headers('x-tenant-id') tenantId: string, @Query() query: QueryParams) {
    return this.crud.findAll(this.crud.v1Config('bulletins'), tenantId, query);
  }

  @Get('reclamations')
  reclamations(@Headers('x-tenant-id') tenantId: string, @CurrentUser() user?: JwtUser) {
    return this.classeService.getTeacherReclamations(tenantId, user?.sub ?? '');
  }

  @Patch('reclamations/:id/traiter')
  traiterReclamation(
    @Headers('x-tenant-id') tenantId: string,
    @Param('id') id: string,
    @Body() body: { statut?: string; reponse?: string; nouvelleNote?: number; noteSur?: number },
    @CurrentUser() user?: JwtUser,
  ) {
    return this.classeService.traiterTeacherReclamation(tenantId, user?.sub ?? '', id, body);
  }

  @Post('appels')
  createAppel(@Headers('x-tenant-id') tenantId: string, @Body() body: Payload, @CurrentUser() user?: JwtUser) {
    return this.crud.create(this.crud.v1Config('appels'), tenantId, body, user?.sub);
  }

  @Get('appels')
  listAppels(@Headers('x-tenant-id') tenantId: string, @Query() query: QueryParams) {
    return this.crud.findAll(this.crud.v1Config('appels'), tenantId, query);
  }

  @Patch('appels/:appelId/soumettre')
  soumettreAppel(@Headers('x-tenant-id') tenantId: string, @Param('appelId') appelId: string) {
    return this.crud.submitAppel(tenantId, appelId);
  }

  @Post('cahier-texte')
  createCahierTexte(@Headers('x-tenant-id') tenantId: string, @Body() body: Payload, @CurrentUser() user?: JwtUser) {
    return this.crud.create(this.crud.v1Config('cahier-texte'), tenantId, body, user?.sub);
  }

  @Get('cahier-texte')
  listCahierTexte(@Headers('x-tenant-id') tenantId: string, @Query() query: QueryParams) {
    return this.crud.findAll(this.crud.v1Config('cahier-texte'), tenantId, query);
  }

  @Patch('cahier-texte/:id')
  updateCahierTexte(@Headers('x-tenant-id') tenantId: string, @Param('id') id: string, @Body() body: Payload) {
    return this.crud.update(this.crud.v1Config('cahier-texte'), tenantId, id, body);
  }
}
