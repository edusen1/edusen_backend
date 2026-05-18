import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { Roles } from "@/common/decorators/roles.decorator";
import { CurrentUser } from "@/common/decorators/current-user.decorator";
import type { JwtUser } from "@/common/types/auth.types";
import { DomainService } from "@/modules/domain.service";

@Roles("ELEVE")
@Controller("eleve")
export class StudentController {
  constructor(private readonly domain: DomainService) {}

  @Get("profil") profil(@CurrentUser() user?: JwtUser) {
    return user ? this.domain.studentProfil(user.sub) : null;
  }
  @Get("notes") notes(
    @Headers("x-tenant-id") tenantId: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.domain.studentNotes(tenantId, user?.sub ?? "");
  }
  @Get("bulletins") bulletins(
    @Headers("x-tenant-id") tenantId: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.domain.studentBulletins(tenantId, user?.sub ?? "");
  }
  @Get("emploi-du-temps") emploiDuTemps(
    @Headers("x-tenant-id") tenantId: string,
  ) {
    return this.domain.v1Emplois(tenantId);
  }
  @Get("absences") absences(
    @Headers("x-tenant-id") tenantId: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.domain.studentAbsences(tenantId, user?.sub ?? "");
  }
  @Get("notifications") notifications(
    @Headers("x-tenant-id") tenantId: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.domain.studentNotifications(tenantId, user?.sub ?? "");
  }
  @Patch("notifications/:id/lire") lireNotification(@Param("id") id: string) {
    return this.domain.studentReadNotification(id);
  }
  @Get("reclamations") reclamations(
    @Headers("x-tenant-id") tenantId: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.domain.studentReclamations(tenantId, user?.sub ?? "");
  }
  @Post("reclamations") createReclamation(
    @Headers("x-tenant-id") tenantId: string,
    @CurrentUser() user: JwtUser,
    @Body() body: { motif: string; noteId?: string },
  ) {
    return this.domain.studentCreateReclamation(
      tenantId,
      user.sub,
      body.motif,
      body.noteId,
    );
  }
}
