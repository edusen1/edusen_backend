import { Body, Controller, Get, Headers, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { JwtUser } from '@/common/types/auth.types';
import { DomainService } from '@/modules/domain.service';
import { LegacyCrudService } from '@/modules/legacy-crud.service';

type QueryParams = Record<string, string | string[] | undefined>;
type Payload = Record<string, unknown>;

@Roles('ENSEIGNANT')
@Controller('enseignant')
export class TeacherController {
  constructor(
    private readonly domain: DomainService,
    private readonly crud: LegacyCrudService,
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

  @Get('emploi-du-temps')
  emploiDuTemps(@Headers('x-tenant-id') tenantId: string, @CurrentUser() user?: JwtUser) {
    return this.crud.findAll(this.crud.v1Config('emplois-du-temps'), tenantId, {
      enseignantId: user?.sub,
    });
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

  @Post('absences')
  createAbsence(@Headers('x-tenant-id') tenantId: string, @Body() body: Payload) {
    return this.crud.create(this.crud.v1Config('absences-eleves'), tenantId, body);
  }

  @Get('bulletins')
  bulletins(@Headers('x-tenant-id') tenantId: string, @Query() query: QueryParams) {
    return this.crud.findAll(this.crud.v1Config('bulletins'), tenantId, query);
  }

  @Get('reclamations')
  reclamations(@Headers('x-tenant-id') tenantId: string, @Query() query: QueryParams) {
    return this.crud.findAll(this.crud.v1Config('reclamations'), tenantId, query);
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
