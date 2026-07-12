import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Patch,
  ParseIntPipe,
  DefaultValuePipe,
  Req,
  Res,
} from '@nestjs/common';
import { Roles } from '@/common/decorators/roles.decorator';
import { AuditRead } from '@/common/decorators/audit-read.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { JwtUser } from '@/common/types/auth.types';
import { LegacyCrudService } from '@/modules/legacy-crud.service';
import { PrismaService } from '@/config/prisma.service';
import { AuthService } from '@/modules/auth/auth.service';
import type { MultipartFastifyRequest } from '@/common/types/multipart-request.types';
import { EcoleConfigService } from '@/modules/configuration/ecole-config.service';
import { UpdateEcoleConfigDto } from '@/modules/configuration/dto/update-ecole-config.dto';
import { UpdateApparenceDto } from '@/modules/configuration/dto/update-apparence.dto';
import { SaveApparencePaletteDto } from '@/modules/configuration/dto/save-apparence-palette.dto';
import { AcademiqueConfigService } from '@/modules/configuration/academique-config.service';
import { SaveFraisDto } from '@/modules/configuration/dto/save-frais.dto';
import { WhatsappService } from '@/modules/whatsapp/whatsapp.service';
import { UpdateWhatsappFeaturesDto } from '@/modules/whatsapp/dto/update-whatsapp-features.dto';
import { ClasseService } from '@/modules/classes/classe.service';
import { CreateClasseDto } from '@/modules/classes/dto/create-classe.dto';
import { UpdateClasseDto } from '@/modules/classes/dto/update-classe.dto';
import { EmploiDuTempsService } from '@/modules/v1/emploi-du-temps/emploi-du-temps.service';
import { BulletinService, PublishBulletinsDto } from '@/modules/v1/bulletin/bulletin.service';
import { DomainService } from '@/modules/domain.service';
import { PresenceProfesseurService } from '@/modules/presence-professeur.service';
import { DemandeReductionService } from '@/modules/v1/demande-reduction/demande-reduction.service';
import { SchoolCardDocumentService } from '@/modules/school-card-document.service';
import { EleveDocumentService } from '@/modules/eleve-document.service';
import { CommunicationService } from '@/modules/communication.service';
import { RapportDocumentService, RapportType } from '@/modules/rapport-document.service';
import { ProgrammeService } from '@/modules/programme/programme.service';
import { StatutPresence, TypeDocument } from '@prisma/client';
import type { FastifyReply } from 'fastify';

type QueryParams = Record<string, string | string[] | undefined>;
type Payload = Record<string, unknown>;

@Roles('ADMIN', 'SURVEILLANT', 'CAISSIER', 'COMPTABLE', 'RH')
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
    private readonly presencesProfesseurs: PresenceProfesseurService,
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly demandeReduction: DemandeReductionService,
    private readonly schoolCards: SchoolCardDocumentService,
    private readonly eleveDocuments: EleveDocumentService,
    private readonly communications: CommunicationService,
    private readonly rapportDocument: RapportDocumentService,
    private readonly programmeService: ProgrammeService,
  ) {}

  private resolveTenantId(tenantId: string | undefined, user?: JwtUser) {
    return this.crud.resolveTenantId(tenantId, user);
  }

  /** Restricts dynamic CRUD routes without blocking each role's own workflow. */
  private assertResourceWriteAccess(resource: string, user?: JwtUser): void {
    if (user?.role === 'ADMIN') return;

    const resourcesByRole: Partial<Record<JwtUser['role'], string[]>> = {
      RH: ['personnel', 'pointages', 'absences-personnel'],
      CAISSIER: ['eleves', 'parents', 'inscriptions', 'paiements'],
      COMPTABLE: ['eleves', 'parents', 'inscriptions', 'paiements'],
      SURVEILLANT: ['absences-eleves', 'convocations', 'discipline'],
    };
    if (!user?.role || !resourcesByRole[user.role]?.includes(resource)) {
      throw new ForbiddenException('Vous ne pouvez pas modifier cette ressource');
    }
  }

  // ----------------------------------------------------------------
  // Classes
  // ----------------------------------------------------------------

  @Roles('ADMIN', 'SURVEILLANT', 'ENSEIGNANT', 'CAISSIER', 'COMPTABLE')
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

  @Roles('ADMIN')
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

  @Get('classes/:id/appels')
  getClasseAppels(@Headers('x-tenant-id') tenantId: string | undefined, @Param('id') id: string, @CurrentUser() user?: JwtUser) {
    return this.resolveTenantId(tenantId, user).then((tid) => this.classeService.getClasseAppels(tid!, id));
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

  @Post('classes/:id/appels')
  createClasseAppel(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') classeId: string,
    @Body() body: { coursId?: string | null; session?: string | null; dateCours: string; heureDebut?: string | null; absents?: string[]; lignes?: { eleveId: string; statut: StatutPresence }[] },
    @CurrentUser() user?: JwtUser,
  ) {
    return this.resolveTenantId(tenantId, user).then((tid) =>
      this.classeService.createAppelWithLignes(tid!, classeId, user?.sub ?? '', {
        coursId: body.coursId ?? null,
        session: body.session ?? null,
        dateCours: body.dateCours,
        heureDebut: body.heureDebut ?? null,
        absents: body.absents ?? [],
        lignes: body.lignes ?? [],
      }),
    );
  }

  @Patch('classes/:id/appels/:appelId')
  updateClasseAppel(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') classeId: string,
    @Param('appelId') appelId: string,
    @Body() body: { lignes?: { eleveId: string; statut: StatutPresence }[] },
    @CurrentUser() user?: JwtUser,
  ) {
    return this.resolveTenantId(tenantId, user).then((tid) =>
      this.classeService.updateAppelLignes(tid!, classeId, appelId, body.lignes ?? []),
    );
  }

  @Roles('ADMIN')
  @Put('classes/:id')
  updateClasse(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateClasseDto,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.resolveTenantId(tenantId, user).then((tid) => this.classeService.updateClasse(tid!, id, dto));
  }

  @Roles('ADMIN')
  @Delete('classes/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteClasse(@Headers('x-tenant-id') tenantId: string | undefined, @Param('id') id: string, @CurrentUser() user?: JwtUser) {
    return this.resolveTenantId(tenantId, user).then((tid) => this.classeService.deleteClasse(tid!, id));
  }

  @Roles('ADMIN')
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

  @Roles('ADMIN')
  @Put('matieres/:id/avec-affectations')
  @Patch('matieres/:id/avec-affectations')
  updateMatiereWithAssignments(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.resolveTenantId(tenantId, user).then((tid) =>
      this.crud.updateMatiereWithAssignments(tid!, id, body),
    );
  }

  @Roles('ADMIN')
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

  @Roles('ADMIN')
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

  @Roles('ADMIN')
  @Post('emplois-du-temps/classe/:classeId')
  createEmploiParClasse(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('classeId') classeId: string,
    @Body() body: Payload,
  ) {
    return this.emploiService.create(tenantId!, { ...(body as any), classeId });
  }

  @Roles('ADMIN')
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

  @Roles('ADMIN')
  @Put('emplois-du-temps/:id')
  @Patch('emplois-du-temps/:id')
  updateEmploi(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @Body() body: Payload,
  ) {
    return this.emploiService.update(tenantId!, id, body as any);
  }

  @Roles('ADMIN')
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

  @AuditRead('EXPORT_BULLETINS')
  @Get('bulletins/download/by-classe')
  downloadByClasse(@Query() query: QueryParams) {
    return { type: 'classe', ...query };
  }

  @AuditRead('EXPORT_BULLETINS')
  @Get('bulletins/download/all')
  downloadAll(@Query() query: QueryParams) {
    return { type: 'all', ...query };
  }

  @AuditRead('EXPORT_BULLETIN')
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

  @Roles('ADMIN')
  @Post('bulletins/publier')
  publierBulletins(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.bulletinService.publierPlusieurs(
      tenantId!,
      body as unknown as PublishBulletinsDto,
      user?.sub ?? 'admin',
    );
  }

  @Post('bulletins/classes/:classeId/publier')
  publierBulletinsParClasse(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('classeId') classeId: string,
    @Query('trimestre') trimestre?: string,
    @Query('anneeScolaire') anneeScolaire?: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.bulletinService.publierParClasse(
      tenantId!,
      classeId,
      user?.sub ?? 'admin',
      trimestre,
      anneeScolaire,
    );
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
  // Absences élèves — routes spécifiques (avant le générique :resource)
  // ----------------------------------------------------------------

  @Get('absences-eleves')
  async listAbsencesEleves(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Query('classeId') classeId?: string,
    @Query('eleveId') eleveId?: string,
    @Query('typeAbsence') typeAbsence?: string,
    @Query('statut') statut?: string,
    @Query('justifiee') justifieeStr?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('search') search?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('size', new DefaultValuePipe(100), ParseIntPipe) size = 100,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = await this.resolveTenantId(tenantId, user);
    const skip = (page - 1) * size;
    const where: Record<string, unknown> = { tenantId: tid };
    if (classeId) where.classeId = classeId;
    if (eleveId) where.eleveId = eleveId;
    if (typeAbsence) where.typeAbsence = typeAbsence;
    if (statut) where.statut = statut;
    if (justifieeStr === 'true') where.justifiee = true;
    else if (justifieeStr === 'false') where.justifiee = false;
    if (dateFrom || dateTo) {
      const dateFilter: Record<string, Date> = {};
      if (dateFrom) dateFilter.gte = new Date(dateFrom);
      if (dateTo) dateFilter.lte = new Date(dateTo);
      where.date = dateFilter;
    }

    const [absences, total] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.prisma.absenceEleve.findMany({ where: where as any, skip, take: size, orderBy: { date: 'desc' }, include: { classe: { select: { id: true, nom: true } } } }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.prisma.absenceEleve.count({ where: where as any }),
    ]);

    const eleveIds = [...new Set(absences.map((a) => a.eleveId))];
    const eleves = eleveIds.length > 0
      ? await this.prisma.user.findMany({ where: { id: { in: eleveIds } }, select: { id: true, firstName: true, lastName: true, matricule: true, photoUrl: true } })
      : [];
    const eleveMap = new Map(eleves.map((e) => [e.id, e]));

    let data = absences.map((a) => {
      const eleve = eleveMap.get(a.eleveId);
      return {
        ...a,
        eleveNom: eleve?.lastName ?? null,
        elevePrenom: eleve?.firstName ?? null,
        eleveMatricule: eleve?.matricule ?? null,
        elevePhoto: eleve?.photoUrl ?? null,
        classeNom: (a.classe as { nom?: string } | null)?.nom ?? null,
        documentJustificatifUrl: a.documentUrl ?? null,
      };
    });

    if (search) {
      const s = search.toLowerCase();
      data = data.filter((a) =>
        `${a.elevePrenom ?? ''} ${a.eleveNom ?? ''} ${a.classeNom ?? ''}`.toLowerCase().includes(s),
      );
    }

    return { data, total, page, size };
  }

  @Get('absences-eleves/stats')
  async statsAbsencesEleves(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = await this.resolveTenantId(tenantId, user);
    const where = { tenantId: tid };

    const [total, enAttente, justifiees, nonJustifiees, retards, journeesCompletes] = await Promise.all([
      this.prisma.absenceEleve.count({ where }),
      this.prisma.absenceEleve.count({ where: { ...where, statut: 'EN_ATTENTE' } }),
      this.prisma.absenceEleve.count({ where: { ...where, statut: 'JUSTIFIEE' } }),
      this.prisma.absenceEleve.count({ where: { ...where, statut: 'NON_JUSTIFIEE' } }),
      this.prisma.absenceEleve.count({ where: { ...where, typeAbsence: 'RETARD' } }),
      this.prisma.absenceEleve.count({ where: { ...where, typeAbsence: 'ABSENT' } }),
    ]);

    return {
      total,
      enAttente,
      approuvees: justifiees,
      rejetees: nonJustifiees,
      justifiees,
      nonJustifiees,
      retards,
      journeesCompletes,
      demandesEleves: enAttente,
    };
  }

  @Get('absences-eleves/demandes')
  async demandesAbsencesEleves(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = await this.resolveTenantId(tenantId, user);
    const absences = await this.prisma.absenceEleve.findMany({
      where: { tenantId: tid, statut: 'EN_ATTENTE' },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { classe: { select: { id: true, nom: true } } },
    });

    const eleveIds = [...new Set(absences.map((a) => a.eleveId))];
    const eleves = eleveIds.length > 0
      ? await this.prisma.user.findMany({ where: { id: { in: eleveIds } }, select: { id: true, firstName: true, lastName: true, matricule: true } })
      : [];
    const eleveMap = new Map(eleves.map((e) => [e.id, e]));

    return absences.map((a) => {
      const eleve = eleveMap.get(a.eleveId);
      return {
        ...a,
        eleveNom: eleve?.lastName ?? null,
        elevePrenom: eleve?.firstName ?? null,
        eleveMatricule: eleve?.matricule ?? null,
        classeNom: (a.classe as { nom?: string } | null)?.nom ?? null,
        documentJustificatifUrl: a.documentUrl ?? null,
        source: 'ADMIN',
      };
    });
  }

  @Get('absences-eleves/top-absents')
  async topAbsentsEleves(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit = 10,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = await this.resolveTenantId(tenantId, user);
    const where = { tenantId: tid };

    const [absGroups, retardGroups, nonJustGroups] = await Promise.all([
      this.prisma.absenceEleve.groupBy({ by: ['eleveId'], where: { ...where, typeAbsence: 'ABSENT' }, _count: { _all: true } }),
      this.prisma.absenceEleve.groupBy({ by: ['eleveId'], where: { ...where, typeAbsence: 'RETARD' }, _count: { _all: true } }),
      this.prisma.absenceEleve.groupBy({ by: ['eleveId'], where: { ...where, statut: 'NON_JUSTIFIEE' }, _count: { _all: true } }),
    ]);

    const statsMap = new Map<string, { nbAbsences: number; nbRetards: number; nbNonJustifiees: number }>();
    for (const g of absGroups) statsMap.set(g.eleveId, { nbAbsences: g._count._all, nbRetards: 0, nbNonJustifiees: 0 });
    for (const g of retardGroups) {
      const s = statsMap.get(g.eleveId) ?? { nbAbsences: 0, nbRetards: 0, nbNonJustifiees: 0 };
      s.nbRetards = g._count._all;
      statsMap.set(g.eleveId, s);
    }
    for (const g of nonJustGroups) {
      const s = statsMap.get(g.eleveId) ?? { nbAbsences: 0, nbRetards: 0, nbNonJustifiees: 0 };
      s.nbNonJustifiees = g._count._all;
      statsMap.set(g.eleveId, s);
    }

    const sorted = [...statsMap.entries()]
      .map(([eleveId, s]) => ({ eleveId, ...s, total: s.nbAbsences + s.nbRetards }))
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);

    if (sorted.length === 0) return [];

    const eleveIds = sorted.map((s) => s.eleveId);
    const [eleves, latestAbsences] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: eleveIds } }, select: { id: true, firstName: true, lastName: true } }),
      this.prisma.absenceEleve.findMany({
        where: { eleveId: { in: eleveIds }, tenantId: tid },
        orderBy: { date: 'desc' },
        distinct: ['eleveId'],
        include: { classe: { select: { nom: true } } },
      }),
    ]);

    const eleveMap = new Map(eleves.map((e) => [e.id, e]));
    const classeMap = new Map(latestAbsences.map((a) => [a.eleveId, (a.classe as { nom?: string } | null)?.nom ?? '—']));

    return sorted.map((s) => ({
      eleveId: s.eleveId,
      eleveNom: eleveMap.get(s.eleveId)?.lastName ?? '—',
      elevePrenom: eleveMap.get(s.eleveId)?.firstName ?? '—',
      classeNom: classeMap.get(s.eleveId) ?? '—',
      nbAbsences: s.nbAbsences,
      nbRetards: s.nbRetards,
      nbNonJustifiees: s.nbNonJustifiees,
    }));
  }

  @Get('absences-eleves/stats/par-cycle')
  async absencesStatsParCycle(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = await this.resolveTenantId(tenantId, user);
    const cycles = await this.prisma.cycle.findMany({ where: { tenantId: tid, actif: true }, orderBy: { libelle: 'asc' } });

    return Promise.all(cycles.map(async (cycle) => {
      const classes = await this.prisma.classe.findMany({ where: { tenantId: tid, cycleId: cycle.id }, select: { id: true } });
      const classeIds = classes.map((c) => c.id);
      if (classeIds.length === 0) return { cycleId: cycle.id, cycleLibelle: cycle.libelle, nbEleves: 0, nbAbsences: 0, nbRetards: 0, nbJustifiees: 0, nbNonJustifiees: 0, moyenneParEleve: 0 };

      const [nbEleves, nbAbsences, nbRetards, nbJustifiees, nbNonJustifiees] = await Promise.all([
        this.prisma.inscription.count({ where: { tenantId: tid, classeId: { in: classeIds }, statut: 'ACTIF' } }),
        this.prisma.absenceEleve.count({ where: { tenantId: tid, classeId: { in: classeIds }, typeAbsence: 'ABSENT' } }),
        this.prisma.absenceEleve.count({ where: { tenantId: tid, classeId: { in: classeIds }, typeAbsence: 'RETARD' } }),
        this.prisma.absenceEleve.count({ where: { tenantId: tid, classeId: { in: classeIds }, statut: 'JUSTIFIEE' } }),
        this.prisma.absenceEleve.count({ where: { tenantId: tid, classeId: { in: classeIds }, statut: 'NON_JUSTIFIEE' } }),
      ]);
      const total = nbAbsences + nbRetards;
      return { cycleId: cycle.id, cycleLibelle: cycle.libelle, nbEleves, nbAbsences, nbRetards, nbJustifiees, nbNonJustifiees, moyenneParEleve: nbEleves > 0 ? Math.round((total / nbEleves) * 10) / 10 : 0 };
    }));
  }

  @Get('absences-eleves/stats/par-niveau')
  async absencesStatsParNiveau(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Query('cycleId') cycleId?: string,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = await this.resolveTenantId(tenantId, user);
    const niveaux = await this.prisma.niveau.findMany({
      where: { tenantId: tid, ...(cycleId ? { cycleId } : {}) },
      orderBy: { ordre: 'asc' },
    });

    return Promise.all(niveaux.map(async (niveau) => {
      const classes = await this.prisma.classe.findMany({ where: { tenantId: tid, niveauId: niveau.id }, select: { id: true } });
      const classeIds = classes.map((c) => c.id);
      if (classeIds.length === 0) return { niveauId: niveau.id, niveauLibelle: niveau.libelle, cycleId: niveau.cycleId, nbClasses: 0, nbEleves: 0, nbAbsences: 0, nbRetards: 0, nbJustifiees: 0, moyenneParEleve: 0 };

      const [nbEleves, nbAbsences, nbRetards, nbJustifiees] = await Promise.all([
        this.prisma.inscription.count({ where: { tenantId: tid, classeId: { in: classeIds }, statut: 'ACTIF' } }),
        this.prisma.absenceEleve.count({ where: { tenantId: tid, classeId: { in: classeIds }, typeAbsence: 'ABSENT' } }),
        this.prisma.absenceEleve.count({ where: { tenantId: tid, classeId: { in: classeIds }, typeAbsence: 'RETARD' } }),
        this.prisma.absenceEleve.count({ where: { tenantId: tid, classeId: { in: classeIds }, statut: 'JUSTIFIEE' } }),
      ]);
      const total = nbAbsences + nbRetards;
      return { niveauId: niveau.id, niveauLibelle: niveau.libelle, cycleId: niveau.cycleId, nbClasses: classeIds.length, nbEleves, nbAbsences, nbRetards, nbJustifiees, moyenneParEleve: nbEleves > 0 ? Math.round((total / nbEleves) * 10) / 10 : 0 };
    }));
  }

  @Get('absences-eleves/stats/par-classe')
  async absencesStatsParClasse(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Query('niveauId') niveauId?: string,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = await this.resolveTenantId(tenantId, user);
    const classes = await this.prisma.classe.findMany({
      where: { tenantId: tid, ...(niveauId ? { niveauId } : {}) },
      orderBy: { nom: 'asc' },
    });

    return Promise.all(classes.map(async (classe) => {
      const [nbEleves, nbAbsences, nbRetards, nbJustifiees] = await Promise.all([
        this.prisma.inscription.count({ where: { tenantId: tid, classeId: classe.id, statut: 'ACTIF' } }),
        this.prisma.absenceEleve.count({ where: { tenantId: tid, classeId: classe.id, typeAbsence: 'ABSENT' } }),
        this.prisma.absenceEleve.count({ where: { tenantId: tid, classeId: classe.id, typeAbsence: 'RETARD' } }),
        this.prisma.absenceEleve.count({ where: { tenantId: tid, classeId: classe.id, statut: 'JUSTIFIEE' } }),
      ]);
      const total = nbAbsences + nbRetards;
      return { classeId: classe.id, classeNom: classe.nom, niveauId: classe.niveauId, nbEleves, nbAbsences, nbRetards, nbJustifiees, moyenneParEleve: nbEleves > 0 ? Math.round((total / nbEleves) * 10) / 10 : 0 };
    }));
  }

  @Get('absences-eleves/stats/evolution')
  async absencesEvolution(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = await this.resolveTenantId(tenantId, user);
    const absences = await this.prisma.absenceEleve.findMany({
      where: { tenantId: tid },
      select: { date: true, typeAbsence: true, statut: true },
      orderBy: { date: 'asc' },
    });

    const monthMap = new Map<string, { nbAbsences: number; nbRetards: number; nbJustifiees: number }>();
    for (const a of absences) {
      const key = a.date.toISOString().slice(0, 7);
      const s = monthMap.get(key) ?? { nbAbsences: 0, nbRetards: 0, nbJustifiees: 0 };
      if (a.typeAbsence === 'RETARD') s.nbRetards++;
      else s.nbAbsences++;
      if (a.statut === 'JUSTIFIEE') s.nbJustifiees++;
      monthMap.set(key, s);
    }

    return [...monthMap.entries()]
      .map(([periode, s]) => ({ periode, ...s }))
      .sort((a, b) => a.periode.localeCompare(b.periode));
  }

  // ----------------------------------------------------------------
  // Présences professeurs — contrôle surveillant et synthèse caisse
  // ----------------------------------------------------------------

  @Roles('ADMIN', 'SURVEILLANT')
  @Get('presences-professeurs/cours-du-jour')
  coursProfesseursDuJour(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Query('date') date: string | undefined,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.resolveTenantId(tenantId, user).then((tid) =>
      this.presencesProfesseurs.coursDuJour(tid!, date || new Date().toISOString().slice(0, 10), user),
    );
  }

  @Roles('ADMIN', 'SURVEILLANT')
  @Post('presences-professeurs')
  enregistrerPresenceProfesseur(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    const date = String(body.dateCours ?? body.date ?? new Date().toISOString().slice(0, 10));
    return this.resolveTenantId(tenantId, user).then((tid) =>
      this.presencesProfesseurs.enregistrerPresence(tid!, date, body, user),
    );
  }

  @Roles('ADMIN', 'CAISSIER', 'COMPTABLE', 'RH', 'SURVEILLANT')
  @Get('presences-professeurs/salaires')
  salairesProfesseurs(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Query('dateDebut') dateDebut: string | undefined,
    @Query('dateFin') dateFin: string | undefined,
    @CurrentUser() user?: JwtUser,
  ) {
    const today = new Date();
    const fallbackEnd = today.toISOString().slice(0, 10);
    const fallbackStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString().slice(0, 10);
    return this.resolveTenantId(tenantId, user).then((tid) =>
      this.presencesProfesseurs.salairesProfesseurs(tid!, dateDebut || fallbackStart, dateFin || fallbackEnd, user),
    );
  }

  @Roles('ADMIN', 'CAISSIER', 'COMPTABLE', 'RH')
  @Get('paiements-professeurs')
  paiementsProfesseurs(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.resolveTenantId(tenantId, user).then((tid) =>
      this.presencesProfesseurs.paiementsProfesseurs(tid!),
    );
  }

  @Roles('ADMIN', 'CAISSIER', 'COMPTABLE', 'RH')
  @Post('paiements-professeurs')
  initialiserPaiementProfesseur(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.resolveTenantId(tenantId, user).then((tid) =>
      this.presencesProfesseurs.initialiserPaiementProfesseur(tid!, body, user),
    );
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

  @Roles('ADMIN')
  @Get('configuration/apparence-palettes')
  getApparencePalettes(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.ecoleConfig.getApparencePalettes(tid!);
  }

  @Roles('ADMIN')
  @Post('configuration/apparence-palettes')
  saveApparencePalette(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Body() dto: SaveApparencePaletteDto,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.ecoleConfig.saveApparencePalette(tid!, dto);
  }

  @Roles('ADMIN')
  @Delete('configuration/apparence-palettes/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteApparencePalette(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.ecoleConfig.deleteApparencePalette(tid!, id);
  }

  // ----------------------------------------------------------------
  // Configuration académique — ADMIN uniquement
  // ----------------------------------------------------------------

  @Get('configuration/annees-academiques')
  getAnnees(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.academiqueConfig.getAnnees(tid!);
  }

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
      dateDebut: body.dateDebut ? String(body.dateDebut) : undefined,
      dateFin: body.dateFin ? String(body.dateFin) : null,
    });
  }

  @Roles('ADMIN')
  @Patch('configuration/annees-academiques/:id')
  updateAnnee(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.academiqueConfig.updateAnnee(tid!, id, {
      libelle: body.libelle !== undefined ? String(body.libelle) : undefined,
      dateDebut: body.dateDebut !== undefined ? String(body.dateDebut) : undefined,
      dateFin: body.dateFin !== undefined ? (body.dateFin ? String(body.dateFin) : null) : undefined,
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
  @Patch('configuration/annees-academiques/:id/finir')
  finirAnnee(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.academiqueConfig.finishAnnee(tid!, id);
  }

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
    return this.academiqueConfig.createSection(tid!, String(body.nom ?? body.libelle ?? ''), body.typePeriode ? String(body.typePeriode) : undefined);
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
      typePeriode: body.typePeriode ? String(body.typePeriode) : undefined,
    });
  }

  @Roles('ADMIN')
  @Delete('configuration/sections/:id')
  deleteSection(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.academiqueConfig.deleteSection(tid!, id);
  }

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
      sectionId: body.sectionId !== undefined ? String(body.sectionId) : undefined,
      nom: body.nom !== undefined || body.libelle !== undefined ? String(body.nom ?? body.libelle) : undefined,
      ordre: body.ordre !== undefined ? Number(body.ordre) : undefined,
      moyennePassage: body.moyennePassage !== undefined ? Number(body.moyennePassage) : undefined,
      actif: body.actif !== undefined ? Boolean(body.actif) : undefined,
    });
  }

  @Roles('ADMIN')
  @Delete('configuration/niveaux/:id')
  deleteNiveau(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.academiqueConfig.deleteNiveau(tid!, id);
  }

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
      heureDebut: body.heureDebut ? String(body.heureDebut) : null,
      heureFin: body.heureFin ? String(body.heureFin) : null,
      type: body.type ? String(body.type) : 'AUTRE',
      statut: body.statut ? String(body.statut) : 'PLANIFIE',
      visibilite: body.visibilite ? String(body.visibilite) : 'TOUS',
      classeId: body.classeId ? String(body.classeId) : null,
      niveauId: body.niveauId ? String(body.niveauId) : null,
      couleur: body.couleur ? String(body.couleur) : null,
      important: body.important === true,
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
      heureDebut: body.heureDebut !== undefined ? (body.heureDebut ? String(body.heureDebut) : null) : undefined,
      heureFin: body.heureFin !== undefined ? (body.heureFin ? String(body.heureFin) : null) : undefined,
      type: body.type !== undefined ? String(body.type) : undefined,
      statut: body.statut !== undefined ? String(body.statut) : undefined,
      visibilite: body.visibilite !== undefined ? String(body.visibilite) : undefined,
      classeId: body.classeId !== undefined ? (body.classeId ? String(body.classeId) : null) : undefined,
      niveauId: body.niveauId !== undefined ? (body.niveauId ? String(body.niveauId) : null) : undefined,
      couleur: body.couleur !== undefined ? (body.couleur ? String(body.couleur) : null) : undefined,
      important: body.important !== undefined ? Boolean(body.important) : undefined,
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
  @Post('whatsapp/pairing-code')
  getWhatsappPairingCode(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    const phoneNumber = body.phoneNumber ? String(body.phoneNumber) : undefined;
    return this.whatsapp.requestPairingCode(tid!, phoneNumber);
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
    @CurrentUser() user?: JwtUser,
  ) {
    return this.resolveTenantId(tenantId, user)
      .then((tid) => this.crud.adminParentChildren(tid, id));
  }

  @Roles('ADMIN', 'SURVEILLANT', 'ENSEIGNANT', 'CAISSIER', 'COMPTABLE')
  @Get('eleves')
  async listEleves(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Query() query: Record<string, string>,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = await this.resolveTenantId(tenantId, user);
    if (!tid) throw new BadRequestException('Tenant introuvable');
    const classeId = query.classeId;
    const size = Math.min(Number(query.size ?? 200), 500);

    if (classeId) {
      // Cherche via inscriptions actives pour fiabilité (User.classeId peut être null)
      const inscriptions = await this.prisma.inscription.findMany({
        where: { tenantId: tid, classeId, statut: 'ACTIF' },
        select: { eleveId: true },
      });
      const eleveIds = inscriptions.map((i) => i.eleveId);
      if (eleveIds.length === 0) return [];
      const eleves = await this.prisma.user.findMany({
        where: { tenantId: tid, role: 'ELEVE', id: { in: eleveIds } },
        select: { id: true, firstName: true, lastName: true, matricule: true, photoUrl: true, classeId: true },
        take: size,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      });
      return eleves;
    }

    // Sans filtre classeId : retour générique paginé
    return this.crud.findAll(this.crud.adminConfig('eleves'), tid, query);
  }

  @Get('eleves/:id/parcours')
  eleveParcours(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.crud.adminEleveParcours(tenantId, id);
  }

  @Get('eleves/:id/dettes')
  eleveDettes(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.crud.adminEleveDettes(tenantId, id);
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

  @AuditRead('CONSULTATION_RECU')
  @Get('paiements/:id/recu')
  getPaiementRecu(@Param('id') id: string) {
    return this.domain.caissePaiementRecu(id);
  }

  @Post('paiements')
  createPaiement(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.domain.caisseCreatePaiement(tenantId!, body as any, user?.sub);
  }

  @Post('paiements/mensualites')
  createMensualitesPaiements(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.domain.caisseCreateMensualitesPaiements(tenantId!, body as any, user?.sub);
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
  // Upload photo utilisateur (élève, enseignant, parent…)
  // ----------------------------------------------------------------

  @Roles('ADMIN', 'CAISSIER', 'COMPTABLE')
  @Post('users/:id/photo')
  @HttpCode(HttpStatus.OK)
  async uploadUserPhoto(
    @Param('id') id: string,
    @Req() req: MultipartFastifyRequest,
    @Body() body: { photoUrl?: string },
  ) {
    if (req.isMultipart?.()) {
      const file = await req.file();
      if (!file) throw new BadRequestException('Aucun fichier fourni');
      const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (!allowed.includes(file.mimetype)) {
        throw new BadRequestException('Format non supporté. Utilisez JPEG, PNG, WebP ou GIF.');
      }
      const buffer = await file.toBuffer();
      if (buffer.length > 2_000_000) throw new BadRequestException('Photo trop volumineuse (max 2 Mo)');
      const photoUrl = await this.authService.uploadProfilePhoto(id, buffer, file.mimetype, file.filename);
      return { photoUrl };
    }
    if (!body?.photoUrl) throw new BadRequestException('photoUrl requis');
    const match = body.photoUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    if (!match) throw new BadRequestException('Format invalide — data URL base64 attendu');
    const contentType = match[1];
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > 2_000_000) throw new BadRequestException('Photo trop volumineuse (max 2 Mo)');
    const photoUrl = await this.authService.uploadProfilePhoto(id, buffer, contentType, 'photo');
    return { photoUrl };
  }

  @Roles('ADMIN', 'CAISSIER', 'RH')
  @Post('users/:id/carte-scolaire')
  async generateUserSchoolCard(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @Body() body: { inscriptionId?: string | null },
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = await this.resolveTenantId(tenantId, user);
    if (!tid) throw new BadRequestException('Tenant introuvable');
    return this.schoolCards.generateForUser(tid, id, { inscriptionId: body?.inscriptionId ?? null });
  }

  @Roles('ADMIN', 'CAISSIER')
  @Post('inscriptions/:id/carte-scolaire')
  async generateInscriptionSchoolCard(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = await this.resolveTenantId(tenantId, user);
    if (!tid) throw new BadRequestException('Tenant introuvable');
    const inscription = await this.prisma.inscription.findFirst({
      where: { id, tenantId: tid },
      select: { eleveId: true },
    });
    if (!inscription) throw new BadRequestException('Inscription introuvable');
    return this.schoolCards.generateForUser(tid, inscription.eleveId, { inscriptionId: id });
  }

  // ----------------------------------------------------------------
  // Statut élève : désactiver / exclure
  // ----------------------------------------------------------------

  @Roles('ADMIN')
  @Patch('eleves/:id/desactiver')
  async desactiverEleve(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') eleveId: string,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = await this.resolveTenantId(tenantId, user);
    if (!tid) throw new BadRequestException('Tenant introuvable');
    const insc = await this.prisma.inscription.findFirst({
      where: { tenantId: tid, eleveId, statut: 'ACTIF' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!insc) throw new NotFoundException('Inscription active introuvable pour cet élève');
    return this.crud.desactiverInscription(tid, insc.id);
  }

  @Roles('ADMIN')
  @Patch('eleves/:id/exclure')
  async exclureEleve(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') eleveId: string,
    @Body() body: { nbAnnees?: number },
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = await this.resolveTenantId(tenantId, user);
    if (!tid) throw new BadRequestException('Tenant introuvable');
    const insc = await this.prisma.inscription.findFirst({
      where: { tenantId: tid, eleveId, statut: 'ACTIF' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!insc) throw new NotFoundException('Inscription active introuvable pour cet élève');
    return this.crud.exclureInscription(tid, insc.id, body.nbAnnees ?? 1);
  }

  // Documents élève (dossier scolaire)
  // ----------------------------------------------------------------

  @Roles('ADMIN', 'CAISSIER', 'COMPTABLE')
  @AuditRead('CONSULTATION_DOCUMENTS')
  @Get('eleves/:id/documents')
  getEleveDocuments(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') eleveId: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.resolveTenantId(tenantId, user).then((tid) =>
      this.eleveDocuments.listDocuments(tid!, eleveId),
    );
  }

  @Roles('ADMIN', 'CAISSIER', 'COMPTABLE')
  @Post('eleves/:id/documents')
  @HttpCode(HttpStatus.CREATED)
  uploadEleveDocument(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') eleveId: string,
    @Body() body: { type: string; nom?: string; fileBase64: string; mimeType: string },
    @CurrentUser() user?: JwtUser,
  ) {
    if (!body?.fileBase64 || !body?.mimeType || !body?.type) {
      throw new BadRequestException('type, fileBase64 et mimeType sont requis');
    }
    return this.resolveTenantId(tenantId, user).then((tid) =>
      this.eleveDocuments.uploadDocument(tid!, eleveId, user?.sub ?? '', {
        type: body.type as TypeDocument,
        nom: body.nom ?? '',
        fileBase64: body.fileBase64,
        mimeType: body.mimeType,
      }),
    );
  }

  @Roles('ADMIN', 'CAISSIER', 'COMPTABLE')
  @Get('eleves/:id/documents/:docId/url')
  getEleveDocumentUrl(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') eleveId: string,
    @Param('docId') docId: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.resolveTenantId(tenantId, user).then((tid) =>
      this.eleveDocuments.getDownloadUrl(tid!, eleveId, docId),
    );
  }

  @Roles('ADMIN')
  @Delete('eleves/:id/documents/:docId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteEleveDocument(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') eleveId: string,
    @Param('docId') docId: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.resolveTenantId(tenantId, user).then((tid) =>
      this.eleveDocuments.deleteDocument(tid!, eleveId, docId),
    );
  }

  // ----------------------------------------------------------------
  // Programmes pédagogiques
  // ----------------------------------------------------------------

  @Roles('ADMIN', 'SURVEILLANT')
  @Get('programmes')
  getProgrammes(@Headers('x-tenant-id') tid: string | undefined, @CurrentUser() u: JwtUser,
    @Query('niveauId') niveauId?: string, @Query('matiereId') matiereId?: string,
    @Query('anneeAcademiqueId') anneeAcademiqueId?: string, @Query('statut') statut?: string) {
    return this.programmeService.findAll((tid?.trim() || u?.tenantId)!, { niveauId, matiereId, anneeAcademiqueId, statut });
  }

  @Roles('ADMIN', 'SURVEILLANT', 'ENSEIGNANT')
  @Get('programmes/avancement')
  getAvancement(@Headers('x-tenant-id') tid: string | undefined, @CurrentUser() u: JwtUser,
    @Query('niveauId') niveauId?: string, @Query('anneeAcademiqueId') anneeAcademiqueId?: string,
    @Query('classeId') classeId?: string, @Query('enseignantId') enseignantId?: string) {
    return this.programmeService.getAvancement((tid?.trim() || u?.tenantId)!, { niveauId, anneeAcademiqueId, classeId, enseignantId });
  }

  @Roles('ADMIN', 'SURVEILLANT')
  @Get('programmes/:id')
  getProgramme(@Headers('x-tenant-id') tid: string | undefined, @CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.programmeService.findOne((tid?.trim() || u?.tenantId)!, id);
  }

  @Roles('ADMIN', 'SURVEILLANT')
  @Post('programmes')
  createProgramme(@Headers('x-tenant-id') tid: string | undefined, @CurrentUser() u: JwtUser, @Body() body: Payload) {
    return this.programmeService.create((tid?.trim() || u?.tenantId)!, body as never);
  }

  @Roles('ADMIN', 'SURVEILLANT')
  @Patch('programmes/:id')
  updateProgramme(@Headers('x-tenant-id') tid: string | undefined, @CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: Payload) {
    return this.programmeService.update((tid?.trim() || u?.tenantId)!, id, body as never);
  }

  @Roles('ADMIN', 'SURVEILLANT')
  @Delete('programmes/:id')
  deleteProgramme(@Headers('x-tenant-id') tid: string | undefined, @CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.programmeService.remove((tid?.trim() || u?.tenantId)!, id);
  }

  @Roles('ADMIN', 'SURVEILLANT')
  @Post('programmes/:id/valider')
  validerProgramme(@Headers('x-tenant-id') tid: string | undefined, @CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.programmeService.valider((tid?.trim() || u?.tenantId)!, id);
  }

  @Roles('ADMIN', 'SURVEILLANT')
  @Post('programmes/:id/dupliquer')
  dupliquerProgramme(@Headers('x-tenant-id') tid: string | undefined, @CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: { anneeAcademiqueId: string }) {
    return this.programmeService.dupliquer((tid?.trim() || u?.tenantId)!, id, body.anneeAcademiqueId);
  }

  @Roles('ADMIN', 'SURVEILLANT')
  @Post('programmes/:id/chapitres')
  addChapitre(@Headers('x-tenant-id') tid: string | undefined, @CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: Payload) {
    return this.programmeService.addChapitre((tid?.trim() || u?.tenantId)!, id, body as never);
  }

  @Roles('ADMIN', 'SURVEILLANT')
  @Patch('programmes/:pid/chapitres/:cid')
  updateChapitre(@Headers('x-tenant-id') tid: string | undefined, @CurrentUser() u: JwtUser, @Param('pid') pid: string, @Param('cid') cid: string, @Body() body: Payload) {
    return this.programmeService.updateChapitre((tid?.trim() || u?.tenantId)!, pid, cid, body as never);
  }

  @Roles('ADMIN', 'SURVEILLANT')
  @Delete('programmes/:pid/chapitres/:cid')
  deleteChapitre(@Headers('x-tenant-id') tid: string | undefined, @CurrentUser() u: JwtUser, @Param('pid') pid: string, @Param('cid') cid: string) {
    return this.programmeService.removeChapitre((tid?.trim() || u?.tenantId)!, pid, cid);
  }

  // ----------------------------------------------------------------
  // Audit logs — ADMIN uniquement
  // ----------------------------------------------------------------

  // ── Demandes d'audit ─────────────────────────────────────────────────

  @Roles('ADMIN')
  @Get('demandes-audit')
  async getDemandesAudit(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = await this.resolveTenantId(tenantId, user);
    if (!tid) throw new BadRequestException('Tenant introuvable');
    return this.prisma.demandeAudit.findMany({
      where: { tenantId: tid },
      orderBy: { createdAt: 'desc' },
      include: { demandeur: { select: { id: true, firstName: true, lastName: true, role: true } } },
    });
  }

  @Roles('ADMIN')
  @Post('demandes-audit')
  async createDemandeAudit(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @CurrentUser() user: JwtUser,
    @Body() body: {
      motif: string; dateDebut: string; dateFin: string;
      filtreActions?: string[]; filtreRoles?: string[]; filtreUserId?: string; filtreResources?: string[];
    },
  ) {
    const tid = await this.resolveTenantId(tenantId, user);
    if (!tid) throw new BadRequestException('Tenant introuvable');
    if (!body.motif?.trim()) throw new BadRequestException('Motif requis');
    if (!body.dateDebut || !body.dateFin) throw new BadRequestException('Période requise');
    return this.prisma.demandeAudit.create({
      data: {
        tenantId: tid,
        demandePar: user.sub,
        motif: body.motif.trim(),
        dateDebut: new Date(body.dateDebut),
        dateFin: new Date(body.dateFin),
        filtreActions: body.filtreActions ?? [],
        filtreRoles: body.filtreRoles ?? [],
        filtreUserId: body.filtreUserId || null,
        filtreResources: body.filtreResources ?? [],
      },
    });
  }

  @Roles('ADMIN')
  @AuditRead('CONSULTATION_AUDIT')
  @Get('audit-logs')
  async getAuditLogs(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @CurrentUser() user?: JwtUser,
    @Query('demandeId') demandeId?: string,
    @Query('page', new DefaultValuePipe(0), ParseIntPipe) page = 0,
    @Query('size', new DefaultValuePipe(50), ParseIntPipe) size = 50,
    @Query('resourceType') resourceType?: string,
    @Query('action') action?: string,
    @Query('utilisateurId') utilisateurId?: string,
  ) {
    const tid = (tenantId?.trim() || user?.tenantId) ?? '';

    // Admin must have an approved, non-expired demande
    if (!demandeId) throw new BadRequestException('Une demande d\'audit approuvée est requise (demandeId)');
    const demande = await this.prisma.demandeAudit.findFirst({
      where: { id: demandeId, tenantId: tid, statut: 'APPROUVEE' },
    });
    if (!demande) throw new BadRequestException('Demande d\'audit introuvable ou non approuvée');
    if (demande.expirationAcces && demande.expirationAcces < new Date()) {
      throw new BadRequestException('L\'accès à cet audit a expiré');
    }

    const where: Record<string, unknown> = {
      tenantId: tid,
      createdAt: { gte: demande.dateDebut, lte: demande.dateFin },
    };
    // Apply demande-level filters (restrict scope to what was approved)
    if (demande.filtreActions.length > 0) where['action'] = { in: demande.filtreActions };
    if (demande.filtreRoles.length > 0) where['role'] = { in: demande.filtreRoles };
    if (demande.filtreUserId) where['utilisateurId'] = demande.filtreUserId;
    if (demande.filtreResources.length > 0) where['resourceType'] = { in: demande.filtreResources };
    // Additional user-side filters (within the approved scope)
    if (resourceType) where['resourceType'] = resourceType;
    if (action) where['action'] = action;
    if (utilisateurId && !demande.filtreUserId) where['utilisateurId'] = utilisateurId;

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: page * size,
        take: size,
        include: {
          utilisateur: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { data, total, page, size, dateDebut: demande.dateDebut, dateFin: demande.dateFin };
  }

  // ----------------------------------------------------------------
  // Discipline
  // ----------------------------------------------------------------

  @Roles('ADMIN', 'SURVEILLANT', 'ENSEIGNANT')
  @Get('discipline')
  async listDiscipline(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Query() query: Record<string, string>,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = await this.resolveTenantId(tenantId, user);
    if (!tid) throw new BadRequestException('Tenant introuvable');
    const where: Record<string, unknown> = { tenantId: tid, statut: { not: 'ANNULE' } };
    if (query.eleveId) where.eleveId = query.eleveId;
    if (query.classeId) where.classeId = query.classeId;
    if (query.statut) where.statut = query.statut; // Override default filter if explicit
    if (query.type) where.type = query.type;
    if (query.rapporteurRole) where.rapporteurRole = query.rapporteurRole;
    if (query.signaleParId) where.signaleParId = query.signaleParId;
    const data = await (this.prisma as any).discipline.findMany({
      where,
      orderBy: { dateIncident: 'desc' },
    });
    return data;
  }

  @Roles('ADMIN', 'SURVEILLANT', 'ENSEIGNANT')
  @Post('discipline')
  async createDiscipline(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = await this.resolveTenantId(tenantId, user);
    if (!tid) throw new BadRequestException('Tenant introuvable');
    const createData: Record<string, unknown> = {
      tenantId: tid,
      eleveNom: String(body.eleveNom ?? ''),
      motif: String(body.motif ?? ''),
      dateIncident: body.dateIncident ? new Date(String(body.dateIncident)) : new Date(),
      type: body.type ?? 'AVERTISSEMENT',
      gravite: Number(body.gravite ?? 2),
      statut: body.statut ?? 'OUVERT',
    };
    if (body.eleveId) createData.eleveId = String(body.eleveId);
    if (body.classeId) createData.classeId = String(body.classeId);
    if (body.eleveClasse) createData.eleveClasse = String(body.eleveClasse);
    if (body.rapporteur) createData.rapporteur = String(body.rapporteur);
    if (body.rapporteurRole) createData.rapporteurRole = String(body.rapporteurRole);
    createData.signaleParId = body.signaleParId ? String(body.signaleParId) : (user?.sub ?? undefined);

    return this.prisma.discipline.create({ data: createData as never });
  }

  @Roles('ADMIN', 'SURVEILLANT', 'ENSEIGNANT')
  @Put('discipline/:id')
  async updateDiscipline(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = await this.resolveTenantId(tenantId, user);
    if (!tid) throw new BadRequestException('Tenant introuvable');
    const updateData: Record<string, unknown> = {};
    if (body.statut !== undefined) updateData.statut = body.statut;
    if (body.type !== undefined) updateData.type = body.type;
    if (body.motif !== undefined) updateData.motif = body.motif;
    if (body.gravite !== undefined) updateData.gravite = Number(body.gravite);
    if (body.sanction !== undefined) updateData.sanction = body.sanction;
    if (body.compteRendu !== undefined) updateData.compteRendu = body.compteRendu;
    if (body.dateDecision !== undefined) updateData.dateDecision = body.dateDecision ? new Date(body.dateDecision as string) : null;
    const data = await (this.prisma as any).discipline.update({
      where: { id, tenantId: tid },
      data: updateData,
    });
    return data;
  }

  @Roles('ADMIN', 'SURVEILLANT', 'ENSEIGNANT')
  @Post('discipline/:id/cloturer')
  async cloturerDiscipline(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = await this.resolveTenantId(tenantId, user);
    if (!tid) throw new BadRequestException('Tenant introuvable');
    const data = await (this.prisma as any).discipline.update({
      where: { id, tenantId: tid },
      data: {
        statut: 'CLOTURE',
        sanction: body.sanction,
        compteRendu: body.compteRendu,
        dateDecision: body.dateDecision ? new Date(body.dateDecision as string) : new Date(),
      },
    });
    return data;
  }

  @Delete('discipline/:id')
  async deleteDiscipline(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = await this.resolveTenantId(tenantId, user);
    if (!tid) throw new BadRequestException('Tenant introuvable');
    await (this.prisma as any).discipline.delete({ where: { id, tenantId: tid } });
    return { message: 'Dossier supprimé' };
  }

  @Roles('ADMIN')
  @Post('personnel/:id/reset-credentials')
  @HttpCode(HttpStatus.OK)
  async resetPersonnelCredentials(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = await this.resolveTenantId(tenantId, user);
    return this.crud.resetPersonnelCredentials(tid, id);
  }

  @Roles('ADMIN')
  @Get('communications')
  async listCommunications(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Query() query: QueryParams,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = await this.resolveTenantId(tenantId, user);
    if (!tid) throw new BadRequestException('Tenant introuvable');
    return this.communications.list(tid, query);
  }

  @Roles('ADMIN')
  @Post('communications/preview-destinataires')
  async previewCommunicationDestinataires(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = await this.resolveTenantId(tenantId, user);
    if (!tid) throw new BadRequestException('Tenant introuvable');
    return this.communications.preview(tid, body);
  }

  @Roles('ADMIN')
  @Post('communications')
  async createCommunication(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = await this.resolveTenantId(tenantId, user);
    if (!tid) throw new BadRequestException('Tenant introuvable');
    return this.communications.create(tid, body, user?.sub);
  }

  @Roles('ADMIN')
  @Post('communications/:id/envoyer')
  async envoyerCommunication(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = await this.resolveTenantId(tenantId, user);
    if (!tid) throw new BadRequestException('Tenant introuvable');
    return this.communications.send(tid, id);
  }

  @Roles('ADMIN')
  @Patch('communications/:id')
  async updateCommunication(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = await this.resolveTenantId(tenantId, user);
    if (!tid) throw new BadRequestException('Tenant introuvable');
    return this.communications.update(tid, id, body);
  }

  @Roles('ADMIN')
  @Delete('communications/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCommunication(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = await this.resolveTenantId(tenantId, user);
    if (!tid) throw new BadRequestException('Tenant introuvable');
    return this.communications.delete(tid, id);
  }

  // ----------------------------------------------------------------
  // ----------------------------------------------------------------
  // Rapports PDF
  // ----------------------------------------------------------------

  @Roles('ADMIN', 'CAISSIER', 'RH', 'SURVEILLANT')
  @AuditRead('EXPORT_PDF')
  @Get('rapports/:type/pdf')
  async generateRapportPdf(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('type') type: string,
    @Query() query: Record<string, string>,
    @CurrentUser() user: JwtUser,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const tid = await this.resolveTenantId(tenantId, user);
    if (!tid) throw new BadRequestException('Tenant introuvable');
    const validTypes: RapportType[] = ['bulletins', 'absences-eleves', 'paiements', 'inscriptions', 'pointages', 'emplois-du-temps', 'communications', 'audit'];
    if (!validTypes.includes(type as RapportType)) throw new BadRequestException(`Type de rapport invalide: ${type}`);
    const { buffer, filename } = await this.rapportDocument.generate(tid, type as RapportType, query);
    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Content-Length', String(buffer.length))
      .send(buffer);
  }

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
  async create(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('resource') resource: string,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    this.assertResourceWriteAccess(resource, user);
    const tid = await this.resolveTenantId(tenantId, user);
    if (!tid) throw new BadRequestException('Tenant introuvable');
    const created = await this.crud.create(this.crud.adminConfig(resource), tid, body, user?.sub);
    if (resource === 'eleves') {
      const eleve = created as Payload;
      const eleveId = typeof eleve.id === 'string'
        ? eleve.id
        : typeof eleve.eleveId === 'string'
          ? eleve.eleveId
          : '';
      if (eleveId) {
        const card = await this.schoolCards
          .generateForUser(tid, eleveId)
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : 'Erreur inconnue';
            console.warn(`[SchoolCard] Génération ignorée pour eleve=${eleveId}: ${message}`);
            return null;
          });
        return { ...eleve, cardUrl: card?.cardUrl ?? null, cardImageUrl: card?.cardImageUrl ?? null };
      }
    }
    return created;
  }

  @Put(':resource/:id')
  update(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('resource') resource: string,
    @Param('id') id: string,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    this.assertResourceWriteAccess(resource, user);
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
    this.assertResourceWriteAccess(resource, user);
    return this.resolveTenantId(tenantId, user).then((tid) => this.crud.delete(this.crud.adminConfig(resource), tid, id));
  }

  // ----------------------------------------------------------------
  // Demandes de réduction / coupons
  // COMPTABLE : crée une demande avec motif
  // ADMIN     : liste tout + approuve / rejette
  // ----------------------------------------------------------------

  @Roles('ADMIN', 'COMPTABLE', 'CAISSIER')
  @Post('reductions/demandes')
  creerDemandeReduction(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Body() body: { eleveId: string; inscriptionId?: string; pourcentage: number; motif: string; commentaireAdmin?: string },
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = (tenantId?.trim() || user?.tenantId)!;
    if (user?.role === 'ADMIN') {
      return this.demandeReduction.createApproved(tid, body, user?.sub ?? '');
    }
    return this.demandeReduction.create(tid, body, user?.sub ?? '');
  }

  @Roles('ADMIN', 'COMPTABLE', 'CAISSIER')
  @Get('reductions/demandes')
  getDemandesReduction(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Query('statut') statut?: string,
    @Query('eleveId') eleveId?: string,
    @Query('mine') mine?: string,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = (tenantId?.trim() || user?.tenantId)!;
    // COMPTABLE/CAISSIER ne voient que leurs propres demandes (sauf si admin)
    if (user?.role !== 'ADMIN' && mine !== 'false') {
      return this.demandeReduction.findMine(tid, user?.sub ?? '');
    }
    return this.demandeReduction.findAll(tid, statut, eleveId);
  }

  @Roles('ADMIN')
  @Patch('reductions/demandes/:id/approuver')
  approuverDemandeReduction(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @Body() body: { commentaire?: string },
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = (tenantId?.trim() || user?.tenantId)!;
    return this.demandeReduction.approuver(tid, id, user?.sub ?? '', body.commentaire);
  }

  @Roles('ADMIN')
  @Patch('reductions/demandes/:id/rejeter')
  rejeterDemandeReduction(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @Body() body: { commentaire: string },
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = (tenantId?.trim() || user?.tenantId)!;
    return this.demandeReduction.rejeter(tid, id, user?.sub ?? '', body.commentaire ?? '');
  }

  // ── Absences enseignants ────────────────────────────────────────────────────
  @Get('absences-enseignants')
  async listAbsencesEnseignants(@Headers('x-tenant-id') tenantId: string | undefined, @CurrentUser() user?: JwtUser) {
    const tid = (tenantId?.trim() || user?.tenantId)!;
    return this.prisma.absenceEnseignant.findMany({
      where: { tenantId: tid },
      include: { enseignant: { select: { id: true, firstName: true, lastName: true, specialite: true, photoUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Patch('absences-enseignants/:id/approuver')
  async approuverAbsenceEnseignant(@Headers('x-tenant-id') tenantId: string | undefined, @CurrentUser() user?: JwtUser, @Param('id') id?: string) {
    return this.prisma.absenceEnseignant.update({ where: { id }, data: { statut: 'APPROUVEE', justifiee: true } });
  }

  @Patch('absences-enseignants/:id/rejeter')
  async rejeterAbsenceEnseignant(@Headers('x-tenant-id') tenantId: string | undefined, @CurrentUser() user?: JwtUser, @Param('id') id?: string) {
    return this.prisma.absenceEnseignant.update({ where: { id }, data: { statut: 'REJETEE' } });
  }

  // ── Absences personnel (non-enseignant) ─────────────────────────────────────
  @Get('absences-personnel-list')
  async listAbsencesPersonnel(@Headers('x-tenant-id') tenantId: string | undefined, @CurrentUser() user?: JwtUser) {
    const tid = (tenantId?.trim() || user?.tenantId)!;
    const absences = await this.prisma.absencePersonnel.findMany({
      where: { tenantId: tid },
      include: { personnel: { include: { utilisateur: { select: { id: true, firstName: true, lastName: true, role: true, photoUrl: true, specialite: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
    // Resolve userId directly when available, enrich response
    const userIds = absences.map((a) => a.userId).filter((id): id is string => !!id);
    const users = userIds.length > 0
      ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, role: true, photoUrl: true, specialite: true } })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));
    return absences.map((a) => {
      const directUser = a.userId ? userMap.get(a.userId) : null;
      const resolvedUser = directUser ?? a.personnel?.utilisateur ?? null;
      return { ...a, utilisateur: resolvedUser };
    });
  }

  @Patch('absences-personnel-list/:id/approuver')
  async approuverAbsencePersonnel2(@Param('id') id: string, @CurrentUser() user?: JwtUser) {
    return this.prisma.absencePersonnel.update({ where: { id }, data: { statut: 'APPROUVEE', validePar: user?.sub } });
  }

  @Patch('absences-personnel-list/:id/rejeter')
  async rejeterAbsencePersonnel2(@Param('id') id: string, @Body() body: { motifRefus?: string }) {
    return this.prisma.absencePersonnel.update({ where: { id }, data: { statut: 'REJETEE', motifRefus: body.motifRefus || null } });
  }
}
