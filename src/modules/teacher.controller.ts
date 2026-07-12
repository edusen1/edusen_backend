import { BadRequestException, Body, Controller, Get, Headers, NotFoundException, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { JwtUser } from '@/common/types/auth.types';
import { DomainService } from '@/modules/domain.service';
import { LegacyCrudService } from '@/modules/legacy-crud.service';
import { ClasseService } from '@/modules/classes/classe.service';
import { StorageService } from '@/infrastructure/storage/storage.service';
import { PrismaService } from '@/config/prisma.service';
import { WhatsappService } from '@/modules/whatsapp/whatsapp.service';
import { PresenceProfesseurService } from '@/modules/presence-professeur.service';
import type { MultipartFastifyRequest } from '@/common/types/multipart-request.types';

type QueryParams = Record<string, string | string[] | undefined>;
type Payload = Record<string, unknown>;

@Roles('ENSEIGNANT')
@Controller('professeur')
export class TeacherController {
  constructor(
    private readonly domain: DomainService,
    private readonly crud: LegacyCrudService,
    private readonly classeService: ClasseService,
    private readonly storage: StorageService,
    private readonly whatsapp: WhatsappService,
    private readonly presenceProfesseurService: PresenceProfesseurService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('profil')
  profil(@CurrentUser() user?: JwtUser) {
    return user ? this.domain.teacherProfil(user.sub) : null;
  }

  @Patch('profil')
  async updateProfil(@CurrentUser() user: JwtUser, @Body() body: Payload) {
    const data: Record<string, unknown> = {};
    if (body.firstName !== undefined) data.firstName = String(body.firstName);
    if (body.lastName !== undefined) data.lastName = String(body.lastName);
    if (body.email !== undefined) data.email = String(body.email) || null;
    if (body.telephone !== undefined) data.telephone = String(body.telephone) || null;
    if (body.specialite !== undefined) data.specialite = String(body.specialite) || null;
    if (body.adresse !== undefined) data.adresse = String(body.adresse) || null;
    return this.prisma.user.update({ where: { id: user.sub }, data });
  }

  @Post('profil/photo')
  async uploadPhoto(@Headers('x-tenant-id') tenantId: string, @Req() req: MultipartFastifyRequest, @CurrentUser() user?: JwtUser) {
    if (!req.isMultipart()) throw new BadRequestException('Multipart requis');
    const file = await req.file();
    if (!file) throw new BadRequestException('Aucun fichier');
    const buffer = await file.toBuffer();
    const key = this.storage.buildDocumentKey(tenantId, 'photos/enseignants', new Date().getFullYear().toString(), user?.sub ?? '', file.filename || 'photo.jpg');
    const stored = await this.storage.upload(key, buffer, file.mimetype);
    const photoUrl = stored.startsWith('http') ? stored : key;
    await this.prisma.user.update({ where: { id: user?.sub }, data: { photoUrl } });
    return { photoUrl };
  }

  @Get('configuration')
  async getConfig(@CurrentUser() user: JwtUser) {
    const u = await this.prisma.user.findUnique({ where: { id: user.sub }, select: { modeCalculNotes: true } });
    return { modeCalculNotes: u?.modeCalculNotes ?? 'MOYENNE' };
  }

  @Patch('configuration')
  async updateConfig(@CurrentUser() user: JwtUser, @Body() body: Payload) {
    const valid = ['MOYENNE', 'MEILLEURE_NOTE'];
    const mode = String(body.modeCalculNotes ?? '');
    if (mode && !valid.includes(mode)) throw new BadRequestException('Mode invalide : MOYENNE ou MEILLEURE_NOTE');
    await this.prisma.user.update({ where: { id: user.sub }, data: { modeCalculNotes: mode || null } });
    return { modeCalculNotes: mode || 'MOYENNE' };
  }

  @Get('paiements')
  paiementsProfesseur(@Headers('x-tenant-id') tenantId: string, @CurrentUser() user?: JwtUser) {
    return this.presenceProfesseurService.paiementsProfesseurPourEnseignant(tenantId, user?.sub ?? '');
  }

  @Post('paiements/:id/valider')
  validerPaiementProfesseur(
    @Headers('x-tenant-id') tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.presenceProfesseurService.validerPaiementProfesseur(tenantId, id, user?.sub ?? '');
  }

  @Post('paiements/:id/rejeter')
  rejeterPaiementProfesseur(
    @Headers('x-tenant-id') tenantId: string,
    @Param('id') id: string,
    @Body() body: { motif?: string },
    @CurrentUser() user?: JwtUser,
  ) {
    return this.presenceProfesseurService.rejeterPaiementProfesseur(tenantId, id, user?.sub ?? '', body?.motif);
  }

  @Get('classes-matieres')
  classesMatieres(@Headers('x-tenant-id') tenantId: string, @CurrentUser() user?: JwtUser, @Query('classeId') classeId?: string) {
    return this.crud.findAll(this.crud.v1Config('matieres-classes'), tenantId, {
      enseignantId: user?.sub,
      ...(classeId ? { classeId } : {}),
    });
  }

  @Get('classes/:id/matieres')
  classeMatieresCompat(
    @Headers('x-tenant-id') tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.crud.findAll(this.crud.v1Config('matieres-classes'), tenantId, {
      enseignantId: user?.sub,
      classeId: id,
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

  @Get('classes/:id/notes/export')
  async exportClasseNotes(
    @Headers('x-tenant-id') tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.classeService.exportTeacherClassNotes(tenantId, user?.sub ?? '', id);
  }

  @Get('classes/:id/eleves/:eleveId/bulletin/export')
  async exportEleveBulletin(
    @Headers('x-tenant-id') tenantId: string,
    @Param('id') id: string,
    @Param('eleveId') eleveId: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.classeService.exportTeacherStudentBulletin(tenantId, user?.sub ?? '', id, eleveId);
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

  @Get('emploi-du-temps/export')
  exportEmploiDuTemps(@Headers('x-tenant-id') tenantId: string, @CurrentUser() user?: JwtUser) {
    return this.classeService.exportTeacherEmploiDuTemps(tenantId, user?.sub ?? '');
  }

  @Get('notes')
  notes(@Headers('x-tenant-id') tenantId: string, @Query() query: QueryParams, @CurrentUser() user?: JwtUser) {
    return this.classeService.getTeacherNotes(tenantId, user?.sub ?? '', query);
  }

  @Post('notes')
  createNote(
    @Headers('x-tenant-id') tenantId: string,
    @Body() body: {
      eleveId: string;
      coursId?: string;
      matiereId?: string;
      valeur?: number;
      note?: number;
      noteSur?: number;
      typeEval?: string;
      typeEvaluation?: string;
      trimestre?: string;
      anneeScolaire?: string;
      commentaire?: string | null;
    },
  ) {
    return this.domain.teacherCreateNote(tenantId, {
      eleveId: body.eleveId,
      coursId: body.coursId,
      matiereId: body.matiereId,
      valeur: body.note ?? body.valeur ?? 0,
      typeEval: body.typeEval ?? body.typeEvaluation,
      trimestre: body.trimestre,
      anneeScolaire: body.anneeScolaire,
      noteSur: body.noteSur,
      commentaire: body.commentaire,
    });
  }

  @Put('notes/:noteId')
  updateNote(@Param('noteId') noteId: string, @Body() body: { valeur?: number; note?: number; commentaire?: string | null }) {
    return this.domain.teacherUpdateNote(noteId, body.note ?? body.valeur ?? 0, body.commentaire);
  }

  @Get('absences')
  absences(@Headers('x-tenant-id') tenantId: string, @CurrentUser() user?: JwtUser) {
    return this.classeService.getTeacherAbsences(tenantId, user?.sub ?? '');
  }

  @Post('absences')
  async createAbsence(@Headers('x-tenant-id') tenantId: string, @Body() body: Payload, @CurrentUser() user?: JwtUser) {
    const absence = await this.classeService.createTeacherAbsence(tenantId, user?.sub ?? '', body as any);
    const teacher = user?.sub ? await this.domain.teacherProfil(user.sub) : null;

    const label = [
      'NouraSchool - Nouvelle absence professeur',
      `Type: ${String(body.typeAbsence ?? 'MALADIE')}`,
      `Du: ${String(body.dateDebut ?? '')}`,
      `Au: ${String(body.dateFin ?? '')}`,
      `Motif: ${String(body.motif ?? '—')}`,
    ].join('\n');

    if (teacher?.telephone) {
      this.whatsapp.sendMessage(tenantId, String(teacher.telephone), label).catch(() => {});
    }
    this.whatsapp.broadcastToRoles(tenantId, label, ['ADMIN']).catch(() => {});

    return absence;
  }

  @Post('absences/justificatif')
  async uploadAbsenceJustificatif(
    @Headers('x-tenant-id') tenantId: string,
    @Req() req: MultipartFastifyRequest,
    @CurrentUser() user?: JwtUser,
  ) {
    if (!req.isMultipart()) throw new BadRequestException('La requête doit être multipart/form-data');
    const file = await req.file();
    if (!file) throw new BadRequestException('Aucun fichier fourni');

    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException('Format non supporté. Utilisez PDF, JPEG, PNG ou WebP.');
    }

    const buffer = await file.toBuffer();
    const annee = String(new Date().getFullYear());
    const key = this.storage.buildDocumentKey(tenantId, 'justificatifs/absences', annee, user?.sub ?? 'inconnu', file.filename || 'justificatif.pdf');
    const stored = await this.storage.upload(key, buffer, file.mimetype);
    const url = stored.startsWith('http') ? stored : this.storage.buildPublicAccessUrl(stored);
    return { justificatifUrl: url, key };
  }

  @Patch('absences/:id')
  async updateAbsence(@Headers('x-tenant-id') tenantId: string, @Param('id') id: string, @Body() body: Payload, @CurrentUser() user?: JwtUser) {
    // Only allow editing EN_ATTENTE absences owned by the user
    const absence = await this.prisma.absenceEnseignant.findFirst({ where: { id, enseignantId: user?.sub ?? '' } });
    if (!absence) throw new NotFoundException('Absence introuvable');
    if (absence.statut !== 'EN_ATTENTE') throw new BadRequestException('Seules les demandes en attente peuvent être modifiées');
    const data: Record<string, unknown> = {};
    if (body.dateDebut) data.dateDebut = new Date(String(body.dateDebut));
    if (body.dateFin) data.dateFin = new Date(String(body.dateFin));
    if (body.heureDebut !== undefined) data.heureDebut = String(body.heureDebut).trim() || null;
    if (body.heureFin !== undefined) data.heureFin = String(body.heureFin).trim() || null;
    if (body.typeAbsence) data.typeAbsence = String(body.typeAbsence);
    if (body.motif) data.motif = String(body.motif).trim();
    if (body.documentJustificatifUrl) data.documentJustificatifUrl = String(body.documentJustificatifUrl);
    return this.prisma.absenceEnseignant.update({ where: { id }, data });
  }

  @Get('bulletins')
  bulletins(@Headers('x-tenant-id') tenantId: string, @Query() query: QueryParams, @CurrentUser() user?: JwtUser) {
    return this.classeService.getTeacherBulletins(tenantId, user?.sub ?? '', query);
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
  async createCahierTexte(@Headers('x-tenant-id') tenantId: string, @Body() body: Payload, @CurrentUser() user?: JwtUser) {
    // If classeId provided but no coursId, find the cours for this prof+classe
    if (!body.coursId && body.classeId && user?.sub) {
      const cours = await this.prisma.cours.findFirst({
        where: { tenantId, classeId: String(body.classeId), enseignantId: user.sub },
        select: { id: true },
      });
      if (cours) body.coursId = cours.id;
      else {
        // Try via EDT
        const edt = await this.prisma.emploiDuTemps.findFirst({
          where: { tenantId, classeId: String(body.classeId), enseignantId: user.sub },
          select: { coursId: true },
        });
        if (edt?.coursId) body.coursId = edt.coursId;
      }
    }
    // classeId is not a CahierTexte field — remove before create
    delete body.classeId;
    return this.crud.create(this.crud.v1Config('cahier-texte'), tenantId, body, user?.sub);
  }

  @Get('cahier-texte')
  async listCahierTexte(@Headers('x-tenant-id') tenantId: string, @Query() query: QueryParams) {
    const classeId = query.classeId as string | undefined;
    if (classeId) {
      // Filter via Cours.classeId
      const where: Record<string, unknown> = { tenantId, cours: { classeId } };
      const entries = await this.prisma.cahierTexte.findMany({
        where,
        orderBy: { dateCours: 'desc' },
        include: { cours: { select: { classeId: true, matiere: { select: { libelle: true } } } }, chapitre: { select: { id: true, numero: true, titre: true } } },
        take: 100,
      });
      return entries;
    }
    return this.crud.findAll(this.crud.v1Config('cahier-texte'), tenantId, query);
  }

  @Patch('cahier-texte/:id')
  updateCahierTexte(@Headers('x-tenant-id') tenantId: string, @Param('id') id: string, @Body() body: Payload) {
    return this.crud.update(this.crud.v1Config('cahier-texte'), tenantId, id, body);
  }

  @Patch('chapitres/:id/statut')
  async updateChapitreStatut(
    @Headers('x-tenant-id') tenantId: string,
    @Param('id') id: string,
    @Body() body: { statut: string },
  ) {
    const allowed = ['NON_COMMENCE', 'EN_COURS', 'TERMINE'];
    const statut = String(body.statut ?? '').toUpperCase();
    if (!allowed.includes(statut)) throw new BadRequestException('Statut invalide');
    const now = new Date();
    const data: Record<string, unknown> = { statut };
    if (statut === 'EN_COURS') data.dateDebut = now;
    if (statut === 'TERMINE') data.dateTermine = now;
    if (statut === 'NON_COMMENCE') { data.dateDebut = null; data.dateTermine = null; }
    return this.prisma.chapitreProgamme.update({ where: { id }, data });
  }

  @Get('programme/stats')
  async programmeStats(@Headers('x-tenant-id') tenantId: string, @Query('classeId') classeId: string, @CurrentUser() user?: JwtUser) {
    if (!classeId) throw new BadRequestException('classeId requis');
    // Get class info to find niveau + annee
    const classe = await this.prisma.classe.findUnique({
      where: { id: classeId },
      select: { niveauId: true, anneeAcademiqueId: true },
    });
    if (!classe || !classe.niveauId) throw new NotFoundException('Classe introuvable');
    // Find programmes for this niveau
    const where: Record<string, unknown> = { tenantId, niveauId: classe.niveauId };
    if (classe.anneeAcademiqueId) where.anneeAcademiqueId = classe.anneeAcademiqueId;
    const programmes = await this.prisma.programmePedagogique.findMany({
      where: where as any,
      include: { chapitres: { orderBy: { numero: 'asc' } } },
    });
    // Notes stats
    const inscriptions = await this.prisma.inscription.findMany({
      where: { tenantId, classeId, statut: 'ACTIF' },
      select: { eleveId: true },
    });
    const eleveIds = inscriptions.map((i) => i.eleveId);
    const notesRaw = eleveIds.length ? await this.prisma.note.findMany({
      where: { tenantId, eleveId: { in: eleveIds } },
      select: { note: true, noteSur: true, typeEvaluation: true, eleveId: true, trimestre: true },
    }) : [];
    // Appels stats
    const appels = await this.prisma.appel.findMany({
      where: { tenantId, classeId },
      select: { id: true, dateCours: true, lignes: { select: { statut: true } } },
      orderBy: { dateCours: 'desc' },
      take: 50,
    });
    // Compute
    const allChapitres = programmes.flatMap((p: any) => p.chapitres ?? []);
    const totalChapitres = allChapitres.length;
    const termines = allChapitres.filter((c: any) => c.statut === 'TERMINE').length;
    const enCours = allChapitres.filter((c: any) => c.statut === 'EN_COURS').length;
    const notesValues = notesRaw.filter((n) => n.typeEvaluation !== 'BONUS').map((n) => n.note);
    const moyenneClasse = notesValues.length ? notesValues.reduce((s, v) => s + v, 0) / notesValues.length : 0;
    const nbNotesSaisies = notesRaw.length;
    const nbAppels = appels.length;
    let totalPresences = 0, totalAbsences = 0, totalRetards = 0;
    for (const appel of appels) {
      for (const l of (appel as any).lignes ?? []) {
        if (l.statut === 'PRESENT') totalPresences++;
        else if (l.statut === 'ABSENT') totalAbsences++;
        else if (l.statut === 'RETARD') totalRetards++;
      }
    }
    const tauxPresence = (totalPresences + totalAbsences + totalRetards) > 0
      ? Math.round((totalPresences / (totalPresences + totalAbsences + totalRetards)) * 100)
      : 100;
    // Per-student averages
    const notesByEleve = new Map<string, number[]>();
    for (const n of notesRaw) {
      if (n.typeEvaluation === 'BONUS') continue;
      if (!notesByEleve.has(n.eleveId)) notesByEleve.set(n.eleveId, []);
      notesByEleve.get(n.eleveId)!.push(n.note);
    }
    const eleveMoyennes = [...notesByEleve.entries()].map(([, vals]) => vals.reduce((s, v) => s + v, 0) / vals.length);
    const nbEnDifficulte = eleveMoyennes.filter((m) => m < 10).length;
    const nbExcellents = eleveMoyennes.filter((m) => m >= 16).length;

    return {
      programme: { totalChapitres, termines, enCours, nonCommences: totalChapitres - termines - enCours, progression: totalChapitres > 0 ? Math.round((termines / totalChapitres) * 100) : 0 },
      notes: { moyenneClasse: Math.round(moyenneClasse * 10) / 10, nbNotesSaisies, nbEleves: eleveIds.length, nbEnDifficulte, nbExcellents },
      appels: { nbAppels, tauxPresence, totalAbsences, totalRetards },
    };
  }

  // ── Communication ────────────────────────────────────────────────────────────
  @Get('communications')
  async listCommunications(@Headers('x-tenant-id') tenantId: string, @CurrentUser() user?: JwtUser) {
    return this.prisma.communication.findMany({
      where: { tenantId, auteurId: user?.sub },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  @Post('communications')
  async createCommunication(@Headers('x-tenant-id') tenantId: string, @Body() body: Payload, @CurrentUser() user?: JwtUser) {
    const classeId = body.classeId ? String(body.classeId) : null;
    if (!classeId) throw new BadRequestException('Veuillez sélectionner une classe');
    if (!body.titre || !body.contenu) throw new BadRequestException('Titre et contenu requis');
    // Verify teacher has access to this class
    await this.classeService.assertTeacherClasseAccess(tenantId, user?.sub ?? '', classeId);
    // Get students in this class
    const inscriptions = await this.prisma.inscription.findMany({
      where: { tenantId, classeId, statut: 'ACTIF' },
      select: { eleveId: true },
    });
    const eleveIds = inscriptions.map((i) => i.eleveId);
    // Create communication
    const comm = await this.prisma.communication.create({
      data: {
        tenantId,
        titre: String(body.titre),
        contenu: String(body.contenu),
        canal: 'IN_APP',
        cibleType: 'CLASSE',
        statut: 'ENVOYE',
        nbDestinataires: eleveIds.length,
        auteurId: user?.sub,
        envoyeLe: new Date(),
      } as any,
    });
    // Create notifications for each student
    for (const eleveId of eleveIds) {
      await this.prisma.notification.create({
        data: { tenantId, userId: eleveId, titre: String(body.titre), message: String(body.contenu), type: 'COMMUNICATION', lue: false } as any,
      }).catch(() => {});
    }
    return comm;
  }
}
