import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
} from "@nestjs/common";
import { Roles } from "@/common/decorators/roles.decorator";
import { CurrentUser } from "@/common/decorators/current-user.decorator";
import type { JwtUser } from "@/common/types/auth.types";
import { DomainService } from "@/modules/domain.service";

@Roles("ENSEIGNANT")
@Controller("enseignant")
export class TeacherController {
  constructor(private readonly domain: DomainService) {}

  @Get("profil") profil(@CurrentUser() user?: JwtUser) {
    return user ? this.domain.teacherProfil(user.sub) : null;
  }
  @Get("classes-matieres") classesMatieres(
    @Headers("x-tenant-id") tenantId: string,
  ) {
    return this.domain.adminEmplois(tenantId);
  }
  @Get("emploi-du-temps") emploiDuTemps(
    @Headers("x-tenant-id") tenantId: string,
  ) {
    return this.domain.v1Emplois(tenantId);
  }
  @Get("notes") notes(@Headers("x-tenant-id") tenantId: string) {
    return this.domain.teacherNotes(tenantId);
  }
  @Post("notes") createNote(
    @Headers("x-tenant-id") tenantId: string,
    @Body()
    body: {
      eleveId: string;
      coursId: string;
      valeur: number;
      typeEval?: string;
    },
  ) {
    return this.domain.teacherCreateNote(tenantId, body);
  }
  @Put("notes/:noteId") updateNote(
    @Param("noteId") noteId: string,
    @Body() body: { valeur: number },
  ) {
    return this.domain.teacherUpdateNote(noteId, body.valeur);
  }
  @Post("absences") createAbsence(
    @Headers("x-tenant-id") tenantId: string,
    @Body() body: { eleveId: string; classeId: string; motif?: string },
  ) {
    return this.domain.teacherCreateAbsence(tenantId, body);
  }
  @Get("bulletins") bulletins(@Headers("x-tenant-id") tenantId: string) {
    return this.domain.adminBulletins(tenantId);
  }
  @Get("reclamations") reclamations(@Headers("x-tenant-id") tenantId: string) {
    return this.domain.adminReclamations(tenantId);
  }
  @Post("appels") createAppel() {
    return { message: "Appel cr��" };
  }
  @Get("appels") listAppels() {
    return [];
  }
  @Patch("appels/:appelId/soumettre") soumettreAppel() {
    return { submitted: true };
  }
  @Post("cahier-texte") createCahierTexte() {
    return { message: "Cahier texte cr��" };
  }
  @Get("cahier-texte") listCahierTexte() {
    return [];
  }
  @Patch("cahier-texte/:id") updateCahierTexte() {
    return { updated: true };
  }
}
